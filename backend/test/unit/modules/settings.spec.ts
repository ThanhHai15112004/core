import {
  FEATURE_FLAG_STATUS,
  FeatureFlagRegistryService,
  MENU_POSITION,
  MENU_TYPE,
  MenuRegistryService,
  SEQUENCE_RESET_POLICY,
  SETTING_VALUE_TYPE,
  SequenceRegistryService,
  SettingRegistryService,
} from '@packages/kernel/index.js';
import { FieldEncryptionService } from '@packages/security/index.js';
import {
  FeatureFlagsService,
  I18nManagementService,
  MenusService,
  SETTINGS_AUDIT_META,
  SequencesService,
  SettingsService,
} from '../../../src/modules/settings/index.js';

describe('SettingsModule — 5 Sub-domains & Helpers Unit Tests', () => {
  let settingRegistry: SettingRegistryService;
  let flagRegistry: FeatureFlagRegistryService;
  let sequenceRegistry: SequenceRegistryService;
  let menuRegistry: MenuRegistryService;
  let encryptionService: FieldEncryptionService;

  let settingsService: SettingsService;
  let featureFlagsService: FeatureFlagsService;
  let i18nService: I18nManagementService;
  let sequencesService: SequencesService;
  let menusService: MenusService;

  beforeEach(() => {
    settingRegistry = new SettingRegistryService();
    flagRegistry = new FeatureFlagRegistryService();
    flagRegistry.setInstalledModules(['settings', 'users', 'roles', 'organizations', 'files']);
    sequenceRegistry = new SequenceRegistryService();
    menuRegistry = new MenuRegistryService();
    menuRegistry.setInstalledModules(['settings', 'users', 'roles', 'organizations', 'files']);
    encryptionService = new FieldEncryptionService();

    settingsService = new SettingsService(
      null,
      null,
      null,
      null,
      settingRegistry,
      encryptionService,
      null,
      null,
    );
    featureFlagsService = new FeatureFlagsService(null, null, flagRegistry, null, null);
    i18nService = new I18nManagementService(null, null, null, null, null);
    sequencesService = new SequencesService(null, null, null, sequenceRegistry, null);
    menusService = new MenusService(null, menuRegistry, null, null);
  });

  it('1. SystemSettings: creates setting group, sensitive setting with AES-256-GCM masking, scope overrides & history', async () => {
    expect(SETTINGS_AUDIT_META.MODULE).toBe('settings');

    const group = await settingsService.createGroup({
      code: 'payment',
      module: 'settings',
      name: 'Cấu hình Thanh toán',
      description: 'Tham số cổng thanh toán',
      sortOrder: 1,
    });
    expect(group.code).toBe('payment');

    const created = await settingsService.createSetting({
      key: 'payment.stripe_secret_key',
      groupCode: 'payment',
      module: 'settings',
      name: 'Stripe Secret Key',
      valueType: SETTING_VALUE_TYPE.TEXT,
      defaultValue: 'sk_test_default',
      value: 'sk_live_secret_123456',
      isSensitive: true,
      allowUnitOverride: true,
    });

    expect(created.key).toBe('payment.stripe_secret_key');
    expect(created.isSensitive).toBe(true);
    expect(created.value).toBe('••••••••');

    const decrypted = await settingsService.getDecryptedValue<string>('payment.stripe_secret_key');
    expect(decrypted).toBe('sk_live_secret_123456');

    await settingsService.updateSettingValue('payment.stripe_secret_key', {
      value: 'sk_unit_override_999',
      environment: 'PRODUCTION',
      organizationUnitId: 5,
      reason: 'Override cho chi nhánh 5',
    });

    const history = await settingsService.listHistory({ settingKey: 'payment.stripe_secret_key' });
    expect(history.length).toBeGreaterThanOrEqual(2);
  });

  it('2. FeatureFlags: creates, toggles, evaluates targeting rules and records history', async () => {
    const flag = await featureFlagsService.createFeatureFlag({
      key: 'users.smart_export_v2',
      module: 'users',
      name: 'Xuất dữ liệu thông minh V2',
      description: 'Cho phép xuất báo cáo nâng cao',
      isEnabled: true,
      rolloutPercentage: 100,
      targetRoles: ['SUPER_ADMIN'],
      targetUserIds: ['42'],
      targetOrganizationUnitIds: [],
    });

    expect(flag.key).toBe('users.smart_export_v2');
    expect(flag.isEnabled).toBe(true);
    expect(flag.status).toBe(FEATURE_FLAG_STATUS.ACTIVE);

    const evalAllowed = await featureFlagsService.evaluate('users.smart_export_v2', {
      userId: '42',
      roles: ['STAFF'],
    });
    expect(evalAllowed.enabled).toBe(true);

    const toggled = await featureFlagsService.toggleFeatureFlag('users.smart_export_v2', {
      isEnabled: false,
      reason: 'Tạm dừng bảo trì',
    });
    expect(toggled.isEnabled).toBe(false);

    const history = await featureFlagsService.listHistory({ flagKey: 'users.smart_export_v2' });
    expect(history.length).toBe(2);
  });

  it('3. I18nManagement: lists and manages locales, timezones, and runtime translations', async () => {
    await i18nService.syncDatabaseCatalog();
    const locales = await i18nService.listLocales();
    expect(locales.length).toBeGreaterThanOrEqual(2);

    const createdLocale = await i18nService.createLocale({
      code: 'ja',
      bcp47Tag: 'ja-JP',
      name: 'Japanese',
      nativeName: '日本語',
      direction: 'ltr',
      dateFormat: 'YYYY/MM/DD',
      datetimeFormat: 'YYYY/MM/DD HH:mm',
      currencyCode: 'JPY',
      numberDecimalSeparator: '.',
      numberGroupSeparator: ',',
      isDefault: false,
      sortOrder: 3,
      status: 1,
    });
    expect(createdLocale.code).toBe('ja');

    const upsertedTrans = await i18nService.upsertTranslation({
      locale: 'vi',
      namespace: 'settings',
      key: 'settings.test.greeting',
      value: 'Xin chào hệ thống cấu hình',
      status: 1,
    });
    expect(upsertedTrans.value).toBe('Xin chào hệ thống cấu hình');
  });

  it('4. Sequences: creates sequence rule, previews without incrementing, and allocates next batch', async () => {
    const created = await sequencesService.createSequenceRule({
      key: 'users.custom_contract_code',
      module: 'users',
      name: 'Mã hợp đồng nhân sự',
      prefix: 'EMP',
      separator: '-',
      paddingLength: 5,
      startValue: 1,
      step: 1,
      resetPolicy: SEQUENCE_RESET_POLICY.YEARLY,
      scopeByUnit: false,
    });

    expect(created.key).toBe('users.custom_contract_code');
    expect(created.samplePreview).toContain('EMP-');

    const preview = sequencesService.preview({
      key: 'users.custom_contract_code',
      prefix: 'NV',
      paddingLength: 4,
    });
    expect(preview.sampleCode).toContain('NV-');

    const next1 = await sequencesService.nextCode('users.custom_contract_code');
    const next2 = await sequencesService.nextCode('users.custom_contract_code');
    expect(next1.sequenceNumber).toBe(1);
    expect(next2.sequenceNumber).toBe(2);
  });

  it('5. DynamicMenus: creates hierarchical menus, toggles cascade status, and builds authorized tree', async () => {
    const parent = await menusService.createMenu({
      code: 'ADMIN_ROOT',
      module: 'settings',
      name: 'Quản trị hệ thống',
      type: MENU_TYPE.GROUP,
      position: MENU_POSITION.SIDEBAR,
      numOrder: 1,
    });
    expect(parent.level).toBe(1);

    const child = await menusService.createMenu({
      code: 'ADMIN_SETTINGS',
      module: 'settings',
      name: 'Cấu hình chung',
      type: MENU_TYPE.ITEM,
      link: '/settings',
      parentCode: 'ADMIN_ROOT',
      position: MENU_POSITION.SIDEBAR,
      key: 'settings.read',
      numOrder: 1,
    });
    expect(child.level).toBe(2);

    const tree = await menusService.getAuthorizedMenuTree({
      position: MENU_POSITION.SIDEBAR,
      permissions: ['settings.read'],
    });
    expect(tree.items.length).toBeGreaterThanOrEqual(1);

    const toggled = await menusService.toggleMenu('ADMIN_ROOT', {
      status: 0,
      cascadeChildren: true,
    });
    expect(toggled.status).toBe(0);
    const childAfterToggle = await menusService.getMenuByCode('ADMIN_SETTINGS');
    expect(childAfterToggle.status).toBe(0);
  });
});
