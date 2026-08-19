import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  AppConfigService,
  AuthzService,
  InjectDrizzle,
  type DrizzleDB,
  RequestEngine,
} from '@platform';
import type { Permission } from '@shared-kernel';
import { desc, eq, and, isNull, gte, or, ilike } from 'drizzle-orm';
import { employees, complianceFindings, accessGrants } from '../../../../../db/schema';
import type { ChatRequest, ChatResponse } from '../domain/ai.types';

// ── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_pending_requests',
    description:
      'Get pending approval requests from the unified inbox. Returns a list of requests awaiting action.',
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description:
            'Filter by request type: access_request, onboarding, offboarding, leave_request, overtime, catalog_request',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (1–20). Default 10.',
        },
      },
    },
  },
  {
    name: 'get_compliance_findings',
    description:
      'Get open device compliance findings (non-compliant devices, encryption issues). Returns current issues needing remediation.',
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['open', 'acknowledged', 'resolved', 'risk_accepted'],
          description: 'Filter by finding status. Omit for open findings.',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (1–20). Default 10.',
        },
      },
    },
  },
  {
    name: 'get_active_access_grants',
    description:
      'Get active access grants for a specific employee. Useful for checking what access someone currently has.',
    input_schema: {
      type: 'object',
      required: ['employeeId'],
      properties: {
        employeeId: {
          type: 'string',
          description: 'Employee ID to look up active grants for',
        },
      },
    },
  },
  {
    name: 'search_employees',
    description:
      'Search for employees by name, email, department, or status. Returns matching employee records.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Name or email to search (partial match)',
        },
        department: {
          type: 'string',
          description: 'Filter by department',
        },
        status: {
          type: 'string',
          enum: ['active', 'on_leave', 'offboarded'],
          description: 'Filter by employment status',
        },
        limit: {
          type: 'number',
          description: 'Max results (1–20). Default 10.',
        },
      },
    },
  },
  {
    name: 'get_my_requests',
    description:
      'Get requests submitted by the current user (the caller). Shows history of their own submissions.',
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'approved', 'rejected', 'expired', 'cancelled', 'in_review'],
          description: 'Filter by status. Omit for all.',
        },
        limit: {
          type: 'number',
          description: 'Max results (1–20). Default 10.',
        },
      },
    },
  },
];

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(actorId: string, actorRole: string): string {
  return `You are an AI assistant embedded in OpsHub, an enterprise IT operations platform used by ${actorRole} staff.

The current user's employee ID is: ${actorId}
Their role is: ${actorRole}

You help with:
- Checking pending approval requests and their status
- Reviewing device compliance findings and security issues
- Looking up employee information and access grants
- Answering questions about IT operations data
- Providing actionable summaries and recommendations

Guidelines:
- Be concise and direct — enterprise users value brevity
- When returning data from tools, summarize key points and highlight items needing urgent attention
- For compliance findings, prioritize by severity (encryption issues > noncompliance)
- Access boundaries are enforced by the tools themselves, not by you. A tool may answer that the
  user is not permitted to read something; relay that plainly and do not attempt another route to
  the same data.
- If you cannot find data, say so clearly rather than guessing
- Format numbers clearly (counts, dates in relative terms like "3 days ago")
- Suggest next actions when relevant ("You have 5 pending items — want me to list them?")

Today's date is ${new Date().toISOString().split('T')[0]}.`;
}

// ── Tool authorization ────────────────────────────────────────────────────────

/**
 * THE TOOL IS THE SECURITY BOUNDARY, NOT THE ROUTE.
 *
 * `POST /ai/chat` used to declare `@SelfScoped("no other user's data is reachable")` and that was
 * false: four of the five tools read the whole organisation. `search_employees` selected from
 * `employees` with no predicate, `get_compliance_findings` returned every open finding,
 * `get_active_access_grants` answered for any employee id. Any employee could ask the assistant to
 * enumerate staff, standing privileged access and open security findings.
 *
 * The fifth, `get_pending_requests`, was broken rather than leaky in a way that looks the same from
 * the chat window — it passed the literal `'system'` as the actor and so matched nothing. See the
 * call site.
 *
 * Nothing in the enforcement layer could have caught it. `@SelfScoped` satisfies both the boot audit
 * and the route-policy ratchet, because both check that a route DECLARES a mode, not that the
 * declaration is true. The system prompt did carry "respect access boundaries" — an instruction to a
 * language model, which is not an access control.
 *
 * So each tool now requires the permission its REST twin requires. A tool the caller may not use is
 * refused with a message rather than an exception: the chat must not 500, and the model needs
 * something to relay. The refusal says only that permission is missing — never whether the data
 * exists.
 */
const TOOL_PERMISSION: Record<string, Permission | null> = {
  /*
   * `null` means SCOPED BY CONSTRUCTION rather than unguarded.
   *
   * Both request tools go through `RequestEngine.list`, which checks `request.read` itself and
   * otherwise narrows to rows where the actor is requester or assignee — deliberately ANDed rather
   * than applied by rewriting the filters, "so a caller cannot widen it back out with requesterId".
   * Requiring a permission here as well would hide the inbox from the employee whose own requests it
   * is.
   */
  get_pending_requests: null,
  get_my_requests: null,

  // The REST twins: GET /compliance/findings and GET /employees.
  get_compliance_findings: 'compliance.read',
  search_employees: 'employee.read',

  /*
   * Reading somebody ELSE'S standing access needs the reviewer's permission. The self case is
   * allowed without it, mirroring `GET /access-requests/grants/me/active`, which is `@SelfScoped` —
   * so this tool is the union of that route and the reviewer's view, and `assertToolAllowed` decides
   * which by comparing the requested employee id to the caller.
   */
  get_active_access_grants: 'access_request.read',
};

/** What a refused tool returns to the model. */
interface ToolRefusal {
  error: string;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly config: AppConfigService,
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly engine: RequestEngine,
    private readonly authz: AuthzService,
  ) {}

  isEnabled(): boolean {
    return !!this.config.get('ANTHROPIC_API_KEY');
  }

  private getClient(): Anthropic {
    return new Anthropic({ apiKey: this.config.get('ANTHROPIC_API_KEY') });
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException(
        'AI assistant is not configured. Set ANTHROPIC_API_KEY to enable.',
      );
    }

    const client = this.getClient();
    const model = this.config.get('ANTHROPIC_MODEL');
    const messages: Anthropic.MessageParam[] = req.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Agentic loop — run until no more tool calls
    let lastText = '';
    let iteration = 0;
    const MAX_ITERATIONS = 5;

    while (iteration < MAX_ITERATIONS) {
      iteration++;
      const response = await client.messages.create({
        model,
        max_tokens: 1024,
        system: buildSystemPrompt(req.actorId, req.actorRole),
        tools: TOOLS,
        messages,
      });

      // Collect text content
      const textBlocks = response.content.filter(
        (b): b is Anthropic.Messages.TextBlock => b.type === 'text',
      );
      if (textBlocks.length > 0) {
        lastText = textBlocks.map((b) => b.text).join('\n');
      }

      if (response.stop_reason !== 'tool_use') break;

      // Process tool calls
      const toolUses = response.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
      );
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        const result = await this.executeTool(
          toolUse.name,
          toolUse.input as Record<string, unknown>,
          req.actorId,
        );
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    return { message: lastText };
  }

  /**
   * Whether `actorId` may run `name` with `input`, or the refusal to hand back to the model.
   *
   * Returns `null` for allowed. Separate from `executeTool` so the decision is assertable on its own:
   * a test that had to drive the agentic loop would need an Anthropic key, and the boundary would go
   * untested for exactly that reason.
   */
  async refusalFor(
    name: string,
    input: Record<string, unknown>,
    actorId: string,
  ): Promise<ToolRefusal | null> {
    // An unknown tool is not an authorization question — the model invented a name.
    if (!(name in TOOL_PERMISSION)) return { error: `Unknown tool: ${name}` };

    const required = TOOL_PERMISSION[name];
    if (required === null) return null;

    // Reading your own standing access is the `grants/me/active` case and needs no permission.
    if (name === 'get_active_access_grants' && input.employeeId === actorId) return null;

    if (await this.authz.check(actorId, required)) return null;

    // Names the missing permission and nothing else. Whether the row exists is not disclosed by a
    // refusal, because the refusal happens before the read.
    this.logger.warn({ tool: name, actorId, required }, 'AI tool refused: missing permission');
    return { error: `You do not have permission to use this tool (requires ${required}).` };
  }

  /**
   * Run one tool for one caller.
   *
   * PUBLIC ON PURPOSE. This is the security boundary — see `TOOL_PERMISSION` — and it has to be
   * drivable by a test that has no Anthropic key, because the alternative is a boundary whose only
   * exercise is a paid API call nobody runs in CI.
   */
  async executeTool(
    name: string,
    input: Record<string, unknown>,
    actorId: string,
  ): Promise<unknown> {
    const refusal = await this.refusalFor(name, input, actorId);
    if (refusal) return refusal;

    this.logger.log({ tool: name, actorId }, 'Executing AI tool');
    try {
      switch (name) {
        case 'get_pending_requests':
          /*
           * THE REAL ACTOR, NOT `'system'` — which was silently broken rather than leaky, and is
           * worth recording because the two failures look identical from the chat window.
           *
           * `AuthzService.check` has no special case for `'system'`, so it resolved no permissions,
           * `unrestricted` was false, and the narrowing predicate became
           * `requesterId = 'system' OR assigneeId = 'system'` — which matches no row that has ever
           * existed. The tool answered "no pending requests" to every caller including an admin.
           * Passing the real actor is what makes it both scoped AND functional.
           */
          return this.toolGetPendingRequests(input, actorId);
        case 'get_compliance_findings':
          return this.toolGetComplianceFindings(input);
        case 'get_active_access_grants':
          return this.toolGetActiveAccessGrants(input);
        case 'search_employees':
          return this.toolSearchEmployees(input);
        case 'get_my_requests':
          return this.toolGetMyRequests(input, actorId);
        default:
          return { error: `Unknown tool: ${name}` };
      }
    } catch (err) {
      this.logger.error({ tool: name }, `Tool execution failed: ${String(err)}`);
      return { error: String(err) };
    }
  }

  private async toolGetPendingRequests(input: Record<string, unknown>, actorId: string) {
    const limit = Math.min(Number(input.limit ?? 10), 20);
    const type = input.type as string | undefined;
    const { rows, total } = await this.engine.list({ status: 'pending', type }, actorId, limit, 0);
    return {
      total,
      items: rows.map((r) => ({
        id: r.id,
        type: r.type,
        requesterId: r.requesterId,
        status: r.status,
        priority: r.priority,
        submittedAt: r.submittedAt,
        slaDeadline: r.slaDeadline,
        slaBreachedAt: r.slaBreachedAt,
      })),
    };
  }

  private async toolGetComplianceFindings(input: Record<string, unknown>) {
    const limit = Math.min(Number(input.limit ?? 10), 20);
    const status = (input.status as string | undefined) ?? 'open';
    const rows = await this.db
      .select({
        id: complianceFindings.id,
        softwareName: complianceFindings.softwareName,
        severity: complianceFindings.severity,
        status: complianceFindings.status,
        source: complianceFindings.source,
        assetId: complianceFindings.assetId,
        employeeId: complianceFindings.employeeId,
        detectedAt: complianceFindings.detectedAt,
      })
      .from(complianceFindings)
      .where(
        eq(
          complianceFindings.status,
          status as 'open' | 'acknowledged' | 'resolved' | 'risk_accepted',
        ),
      )
      .orderBy(desc(complianceFindings.detectedAt), desc(complianceFindings.id))
      .limit(limit);
    return { count: rows.length, items: rows };
  }

  private async toolGetActiveAccessGrants(input: Record<string, unknown>) {
    const employeeId = input.employeeId as string;
    const now = new Date();
    const rows = await this.db
      .select({
        id: accessGrants.id,
        accessType: accessGrants.accessType,
        target: accessGrants.target,
        grantedAt: accessGrants.grantedAt,
        expiresAt: accessGrants.expiresAt,
      })
      .from(accessGrants)
      .where(
        and(
          eq(accessGrants.granteeId, employeeId),
          isNull(accessGrants.revokedAt),
          gte(accessGrants.expiresAt, now),
        ),
      )
      .orderBy(desc(accessGrants.grantedAt), desc(accessGrants.id))
      .limit(20);
    return { employeeId, activeGrantCount: rows.length, grants: rows };
  }

  private async toolSearchEmployees(input: Record<string, unknown>) {
    const limit = Math.min(Number(input.limit ?? 10), 20);
    const status = input.status as string | undefined;
    const query = input.query as string | undefined;
    const department = input.department as string | undefined;

    /*
     * THE SEARCH IS IN SQL, and it has to be.
     *
     * This used to take the newest `limit` rows and THEN filter them in JavaScript, so "find Priya"
     * answered from whichever of the ten most recently created employees happened to match — almost
     * always none. A search that silently looks at 10 of 300 rows reports "not found" for somebody
     * who is right there, which is worse than an error.
     *
     * `department` was declared in the tool schema and never read at all.
     */
    const conditions = [
      status ? eq(employees.status, status as 'active' | 'on_leave' | 'offboarded') : undefined,
      department ? eq(employees.department, department) : undefined,
      query
        ? or(ilike(employees.displayName, `%${query}%`), ilike(employees.email, `%${query}%`))
        : undefined,
    ].filter(Boolean);

    const rows = await this.db
      .select({
        id: employees.id,
        displayName: employees.displayName,
        email: employees.email,
        department: employees.department,
        jobTitle: employees.jobTitle,
        status: employees.status,
      })
      .from(employees)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(employees.createdAt), desc(employees.id))
      .limit(limit);

    return { count: rows.length, employees: rows };
  }

  private async toolGetMyRequests(input: Record<string, unknown>, actorId: string) {
    const limit = Math.min(Number(input.limit ?? 10), 20);
    const status = input.status as string | undefined;
    const { rows, total } = await this.engine.list(
      { requesterId: actorId, status: status as never },
      actorId,
      limit,
      0,
    );
    return {
      total,
      items: rows.map((r) => ({
        id: r.id,
        type: r.type,
        status: r.status,
        priority: r.priority,
        submittedAt: r.submittedAt,
        resolvedAt: r.resolvedAt,
      })),
    };
  }
}
