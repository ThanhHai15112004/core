export type ModuleType = 'core' | 'project';

export interface ModuleEventsManifest {
  published?: string[];
  subscribed?: string[];
}

export interface ModuleDatabaseManifest {
  hasMigrations?: boolean;
  tables?: string[];
}

export interface ModuleManifest {
  $schema?: string;
  name: string;
  displayName: string;
  version: string;
  description?: string;
  type: ModuleType;
  category?: string;
  author?: string;
  entryModule: string;
  dependencies?: string[];
  permissions?: string[];
  events?: ModuleEventsManifest;
  database?: ModuleDatabaseManifest;
}

export interface ProjectManifestSettings {
  defaultLocale?: string;
  supportedLocales?: string[];
}

export interface ProjectManifest {
  $schema?: string;
  name: string;
  version: string;
  coreVersion: string;
  description?: string;
  environment?: string;
  enabledModules: string[];
  settings?: ProjectManifestSettings;
}
