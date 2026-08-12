import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiCommonErrors,
  ApiPagedResponse,
  Auth,
  CurrentUser,
  RequirePermission,
  SelfScoped,
  buildPageResult,
  type JwtPayload,
  type PagedResult,
} from '@platform';
import { EmployeeService } from '@modules/identity';
import { PositionsService } from '../../application/positions.service';
import type { EmployeePosition, Position, PositionOccupancy } from '../../domain/positions.types';
import {
  AssignPositionDto,
  CreatePositionDto,
  EmployeePositionResponseDto,
  EndAssignmentDto,
  ListPositionsQueryDto,
  PositionOccupancyResponseDto,
  PositionResponseDto,
  UpdatePositionDto,
} from './dto/positions.dto';

function toPositionDto(p: Position): PositionResponseDto {
  return {
    id: p.id,
    code: p.code,
    title: p.title,
    department: p.department,
    level: p.level,
    headcount: p.headcount,
    description: p.description,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
  };
}

function toOccupancyDto(p: PositionOccupancy): PositionOccupancyResponseDto {
  return { ...toPositionDto(p), filled: p.filled, vacancies: p.vacancies };
}

function toAssignmentDto(a: EmployeePosition): EmployeePositionResponseDto {
  return {
    id: a.id,
    employeeId: a.employeeId,
    positionId: a.positionId,
    effectiveFrom: a.effectiveFrom,
    effectiveTo: a.effectiveTo,
    endReason: a.endReason,
    createdAt: a.createdAt.toISOString(),
  };
}

@ApiTags('positions')
@Controller('positions')
@Auth()
export class PositionsController {
  constructor(
    private readonly service: PositionsService,
    private readonly employees: EmployeeService,
  ) {}

  /**
   * The position the CALLER holds, and their history.
   *
   * Self-scoped and first because it is the only route here most employees need. Knowing your own
   * role and when it changed is not privileged information about anyone else.
   */
  @Get('me')
  @SelfScoped("returns the caller's own position history — keyed on their own id")
  @ApiOperation({ summary: 'My position history, newest first' })
  @ApiOkResponse({ type: [EmployeePositionResponseDto] })
  @ApiCommonErrors(401)
  async myPositions(@CurrentUser() user: JwtPayload): Promise<EmployeePositionResponseDto[]> {
    return (await this.service.listAssignmentsForEmployee(user.sub)).map(toAssignmentDto);
  }

  @Get()
  @RequirePermission('position.read')
  @ApiOperation({
    summary: 'List positions with occupancy',
    description:
      'Each row carries `filled` (open assignments) and `vacancies` (`headcount - filled`, ' +
      'floored at 0). `vacantOnly` narrows to positions with an unfilled approved slot.',
  })
  @ApiPagedResponse(PositionOccupancyResponseDto)
  @ApiCommonErrors(401, 403)
  async list(
    @Query() query: ListPositionsQueryDto,
  ): Promise<PagedResult<PositionOccupancyResponseDto>> {
    const { rows, total } = await this.service.listPositions(
      {
        search: query.search,
        department: query.department,
        status: query.status,
        vacantOnly: query.vacantOnly,
      },
      query.limit,
      query.offset,
    );
    return buildPageResult(rows.map(toOccupancyDto), total, query.limit, query.offset);
  }

  @Get(':id')
  @RequirePermission('position.read')
  @ApiOperation({ summary: 'Get a position' })
  @ApiOkResponse({ type: PositionResponseDto })
  @ApiCommonErrors(401, 403, 404)
  async getById(@Param('id', ParseUUIDPipe) id: string): Promise<PositionResponseDto> {
    return toPositionDto(await this.service.getPosition(id));
  }

  @Get(':id/assignments')
  @RequirePermission('position.read')
  @ApiOperation({
    summary: 'Everyone who has held this position, newest first',
    description: 'History, not just current occupants — closed assignments are never deleted.',
  })
  @ApiOkResponse({ type: [EmployeePositionResponseDto] })
  @ApiCommonErrors(401, 403, 404)
  async listAssignments(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EmployeePositionResponseDto[]> {
    return (await this.service.listAssignmentsForPosition(id)).map(toAssignmentDto);
  }

  @Post()
  @RequirePermission('position.manage')
  @ApiOperation({ summary: 'Define a position' })
  @ApiCreatedResponse({ type: PositionResponseDto })
  @ApiCommonErrors(401, 403, 409, 422)
  async create(
    @Body() dto: CreatePositionDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<PositionResponseDto> {
    return toPositionDto(await this.service.createPosition(dto, user));
  }

  @Patch(':id')
  @RequirePermission('position.manage')
  @ApiOperation({
    summary: 'Change a position, including approved headcount',
    description:
      'Reducing headcount below current occupancy is ALLOWED — a restructure is a real event — ' +
      'and shows as `vacancies: 0` with `filled > headcount`. No new assignment can be made ' +
      'until that resolves.',
  })
  @ApiOkResponse({ type: PositionResponseDto })
  @ApiCommonErrors(401, 403, 404, 422)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePositionDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<PositionResponseDto> {
    return toPositionDto(await this.service.updatePosition(id, dto, user));
  }

  @Post(':id/assignments')
  @RequirePermission('position.manage')
  @ApiOperation({
    summary: 'Assign an employee, transferring them if they hold another position',
    description:
      'One transaction: closes any current assignment, checks approved headcount, opens the new ' +
      'one. A frozen or closed position accepts nobody new.',
  })
  @ApiCreatedResponse({ type: EmployeePositionResponseDto })
  @ApiCommonErrors(401, 403, 404, 409, 412, 422)
  async assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignPositionDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<EmployeePositionResponseDto> {
    // `employee_id` carries no cross-schema FK, matching every other module, so a typo would
    // otherwise become an assignment for somebody who does not exist.
    await this.employees.getById(dto.employeeId);
    return toAssignmentDto(
      await this.service.assign(
        {
          employeeId: dto.employeeId,
          positionId: id,
          effectiveFrom: dto.effectiveFrom,
          endReason: dto.endReason,
        },
        user,
      ),
    );
  }

  @Patch('assignments/:id/end')
  @RequirePermission('position.manage')
  @ApiOperation({
    summary: 'End an assignment without opening another',
    description:
      'A departure or a vacated role. The row is closed, never deleted. An `effectiveTo` before ' +
      'the assignment started is refused with `POSITION_INVALID_WINDOW`.',
  })
  @ApiOkResponse({ type: EmployeePositionResponseDto })
  @ApiCommonErrors(401, 403, 404, 412, 422)
  async endAssignment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EndAssignmentDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<EmployeePositionResponseDto> {
    return toAssignmentDto(await this.service.endAssignment(id, dto, user));
  }

  @Get('employees/:employeeId/history')
  @RequirePermission('position.read')
  @ApiOperation({ summary: "One employee's position history, newest first" })
  @ApiOkResponse({ type: [EmployeePositionResponseDto] })
  @ApiCommonErrors(401, 403, 404)
  async employeeHistory(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
  ): Promise<EmployeePositionResponseDto[]> {
    await this.employees.getById(employeeId);
    return (await this.service.listAssignmentsForEmployee(employeeId)).map(toAssignmentDto);
  }
}
