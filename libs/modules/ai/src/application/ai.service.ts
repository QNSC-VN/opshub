import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AppConfigService, InjectDrizzle, type DrizzleDB, RequestEngine } from '@platform';
import { desc, eq, and, isNull, gte } from 'drizzle-orm';
import { employees, complianceFindings, accessGrants } from '../../../../../db/schema';
import type { ChatMessage, ChatRequest, ChatResponse } from '../domain/ai.types';

// ── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_pending_requests',
    description: 'Get pending approval requests from the unified inbox. Returns a list of requests awaiting action.',
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Filter by request type: access_request, onboarding, offboarding, leave_request, overtime, catalog_request',
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
    description: 'Get open device compliance findings (non-compliant devices, encryption issues). Returns current issues needing remediation.',
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
    description: 'Get active access grants for a specific employee. Useful for checking what access someone currently has.',
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
    description: 'Search for employees by name, email, department, or status. Returns matching employee records.',
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
    description: 'Get requests submitted by the current user (the caller). Shows history of their own submissions.',
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
- Respect access boundaries: employees can see their own requests; admins can see all
- If you cannot find data, say so clearly rather than guessing
- Format numbers clearly (counts, dates in relative terms like "3 days ago")
- Suggest next actions when relevant ("You have 5 pending items — want me to list them?")

Today's date is ${new Date().toISOString().split('T')[0]}.`;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly config: AppConfigService,
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly engine: RequestEngine,
  ) {}

  isEnabled(): boolean {
    return !!this.config.get('ANTHROPIC_API_KEY');
  }

  private getClient(): Anthropic {
    return new Anthropic({ apiKey: this.config.get('ANTHROPIC_API_KEY') });
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException('AI assistant is not configured. Set ANTHROPIC_API_KEY to enable.');
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
      const textBlocks = response.content.filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text');
      if (textBlocks.length > 0) {
        lastText = textBlocks.map((b) => b.text).join('\n');
      }

      if (response.stop_reason !== 'tool_use') break;

      // Process tool calls
      const toolUses = response.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use');
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        const result = await this.executeTool(toolUse.name, toolUse.input as Record<string, unknown>, req.actorId);
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

  private async executeTool(name: string, input: Record<string, unknown>, actorId: string): Promise<unknown> {
    this.logger.log({ tool: name, actorId }, 'Executing AI tool');
    try {
      switch (name) {
        case 'get_pending_requests':
          return this.toolGetPendingRequests(input);
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

  private async toolGetPendingRequests(input: Record<string, unknown>) {
    const limit = Math.min(Number(input.limit ?? 10), 20);
    const type = input.type as string | undefined;
    const { rows, total } = await this.engine.list(
      { status: 'pending', type },
      'system',
      limit,
      0,
    );
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
      .where(eq(complianceFindings.status, status as 'open' | 'acknowledged' | 'resolved' | 'risk_accepted'))
      .orderBy(desc(complianceFindings.detectedAt))
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
      .orderBy(desc(accessGrants.grantedAt))
      .limit(20);
    return { employeeId, activeGrantCount: rows.length, grants: rows };
  }

  private async toolSearchEmployees(input: Record<string, unknown>) {
    const limit = Math.min(Number(input.limit ?? 10), 20);
    const status = input.status as string | undefined;
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
      .where(status ? eq(employees.status, status as 'active' | 'on_leave' | 'offboarded') : undefined)
      .orderBy(desc(employees.createdAt))
      .limit(limit);
    // Client-side filter by query if provided (simple contains)
    const query = (input.query as string | undefined)?.toLowerCase();
    const filtered = query
      ? rows.filter(
          (e) =>
            e.displayName?.toLowerCase().includes(query) ||
            e.email?.toLowerCase().includes(query),
        )
      : rows;
    return { count: filtered.length, employees: filtered };
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
