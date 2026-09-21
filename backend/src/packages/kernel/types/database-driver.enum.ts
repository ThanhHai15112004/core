export enum DatabaseDriver {
  MYSQL = 'mysql',
  POSTGRES = 'pgsql',
  POSTGRESQL = 'postgres',
  MSSQL = 'mssql',
  SQLITE = 'sqlite',
}

export const DEFAULT_DATABASE_PORTS: Record<DatabaseDriver, number> = {
  [DatabaseDriver.MYSQL]: 3306,
  [DatabaseDriver.POSTGRES]: 5432,
  [DatabaseDriver.POSTGRESQL]: 5432,
  [DatabaseDriver.MSSQL]: 1433,
  [DatabaseDriver.SQLITE]: 0,
};
