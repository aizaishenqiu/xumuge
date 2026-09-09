/**
 * fou-roster: employee CRUD & desk binding.
 * Re-exports xu.db helpers; must not call Agent / Hermes.
 * Shared enums live in ./types — do not re-export them here (avoids index barrel clash).
 */
export {
  type Employee,
  type EmployeeInput,
  type AvatarStyle,
  AVATAR_STYLES,
  getAvatar,
  bootstrapEmployees,
  loadEmployees,
  readEmployees,
  saveEmployee,
  addEmployee,
  updateEmployee,
  removeEmployee,
  nextFreeDeskIndex,
  listOccupiedDeskIndices,
  unbindEmployeesFromDesks,
  employeeBoundarySummary,
  appendFouMessage,
} from "../utils/employees";
