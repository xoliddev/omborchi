/** Roles, permissions and warehouse scoping. */

export const ROLES = ['owner', 'manager', 'cashier', 'storekeeper'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'dashboard.view',
  'catalog.view',
  'catalog.edit',
  'stock.view',
  'stock.receive',
  'stock.transfer',
  'stock.writeoff',
  'stock.count',
  'purchasing.view',
  'purchasing.edit',
  'suppliers.pay',
  'sales.create',
  'sales.view',
  'sales.return',
  'sales.discount',
  'customers.view',
  'customers.edit',
  'customers.collect',
  'reports.view',
  'audit.view',
  'settings.edit',
  'users.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = new Set<Permission>(PERMISSIONS);

const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  owner: ALL,
  manager: new Set(PERMISSIONS.filter((p) => p !== 'users.manage' && p !== 'settings.edit')),
  cashier: new Set<Permission>([
    'catalog.view',
    'stock.view',
    'sales.create',
    'sales.view',
    'customers.view',
    'customers.edit',
    'customers.collect',
  ]),
  storekeeper: new Set<Permission>([
    'catalog.view',
    'catalog.edit',
    'stock.view',
    'stock.receive',
    'stock.transfer',
    'stock.writeoff',
    'stock.count',
    'purchasing.view',
  ]),
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role]?.has(permission) ?? false;
}

export function permissionsFor(role: Role): Permission[] {
  return PERMISSIONS.filter((p) => can(role, p));
}

export interface WarehouseScope {
  role: Role;
  /** null = all warehouses (owners & managers by default). */
  warehouseIds: string[] | null;
}

export function canAccessWarehouse(scope: WarehouseScope, warehouseId: string): boolean {
  if (scope.role === 'owner') return true;
  if (scope.warehouseIds === null) return true;
  return scope.warehouseIds.includes(warehouseId);
}
