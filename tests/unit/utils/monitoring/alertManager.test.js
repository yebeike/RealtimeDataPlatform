// 文件位置: tests/unit/utils/monitoring/alertManager.test.js

const AlertManager = require('../../../../src/utils/monitoring/AlertManager');

describe('AlertManager', () => {
  let alertManager;

  beforeEach(() => {
    alertManager = new AlertManager({
      maxHistorySize: 10
    });
  });

  test('应该正确初始化告警管理器', () => {
    expect(alertManager).toBeDefined();
    expect(alertManager.alerts instanceof Map).toBe(true);
    expect(alertManager.alertHistory).toEqual([]);
    expect(alertManager.rules instanceof Map).toBe(true);
    expect(alertManager.notifiers.length).toBe(1); // 默认日志通知器
  });

  test('应该能触发告警', () => {
    const alertName = 'test_alert';
    const alertMessage = 'Test alert message';
    const severity = AlertManager.AlertSeverity.WARNING;
    const labels = ['test', 'unit'];
    
    const alert = alertManager.alert(alertName, alertMessage, severity, labels);
    
    expect(alert).toBeDefined();
    expect(alert.name).toBe(alertName);
    expect(alert.message).toBe(alertMessage);
    expect(alert.severity).toBe(severity);
    expect(alert.labels).toEqual(labels);
    expect(alert.status).toBe(AlertManager.AlertStatus.ACTIVE);
    
    // 应该添加到活跃告警
    expect(alertManager.alerts.has(alertName)).toBe(true);
    
    // 应该添加到历史记录
    expect(alertManager.alertHistory.length).toBe(1);
    expect(alertManager.alertHistory[0].name).toBe(alertName);
  });

  test('应该能解决告警', () => {
    // 先触发一个告警
    const alertName = 'resolve_test';
    alertManager.alert(alertName, 'Alert to be resolved');
    
    // 确认告警存在
    expect(alertManager.alerts.has(alertName)).toBe(true);
    
    // 解决告警
    const resolved = alertManager.resolve(alertName, 'Issue fixed');
    
    expect(resolved).toBe(true);
    expect(alertManager.alerts.has(alertName)).toBe(false);
    
    // 应该仍在历史记录中，但状态更新
    const alertHistory = alertManager.getAlertHistory();
    const resolvedAlert = alertHistory.find(a => a.name === alertName);
    
    expect(resolvedAlert).toBeDefined();
    expect(resolvedAlert.status).toBe(AlertManager.AlertStatus.RESOLVED);
    expect(resolvedAlert.resolveMessage).toBe('Issue fixed');
  });

  test('应该能确认告警', () => {
    // 先触发一个告警
    const alertName = 'acknowledge_test';
    alertManager.alert(alertName, 'Alert to be acknowledged');
    
    // 确认告警存在
    expect(alertManager.alerts.has(alertName)).toBe(true);
    
    // 确认告警
    const acknowledged = alertManager.acknowledge(alertName, 'test_user', 'Working on it');
    
    expect(acknowledged).toBe(true);
    
    // 告警仍应该存在，但状态更新
    expect(alertManager.alerts.has(alertName)).toBe(true);
    const alert = alertManager.alerts.get(alertName);
    expect(alert.status).toBe(AlertManager.AlertStatus.ACKNOWLEDGED);
    expect(alert.acknowledgedBy).toBe('test_user');
    expect(alert.acknowledgeMessage).toBe('Working on it');
  });

  test('应该能静默告警', () => {
    // 先触发一个告警
    const alertName = 'silence_test';
    alertManager.alert(alertName, 'Alert to be silenced', AlertManager.AlertSeverity.ERROR, ['test']);
    
    // 确认告警存在
    expect(alertManager.alerts.has(alertName)).toBe(true);
    
    // 静默告警
    const silenceId = alertManager.silence(alertName, 3600000, ['test'], 'test_user', 'Maintenance window');
    
    expect(silenceId).toBeDefined();
    
    // 告警应该被静默
    const alert = alertManager.alerts.get(alertName);
    expect(alert.status).toBe(AlertManager.AlertStatus.SILENCED);
    expect(alert.silencedBy).toBe(silenceId);
    
    // 静默应该被记录
    expect(alertManager.silencedAlerts.has(silenceId)).toBe(true);
    const silence = alertManager.silencedAlerts.get(silenceId);
    expect(silence.name).toBe(alertName);
    expect(silence.silencedBy).toBe('test_user');
  });

  test('应该能取消静默', () => {
    // 先触发和静默一个告警
    const alertName = 'unsilence_test';
    alertManager.alert(alertName, 'Alert to unsilence');
    const silenceId = alertManager.silence(alertName, 3600000, [], 'test_user');
    
    // 确认告警被静默
    expect(alertManager.alerts.get(alertName).status).toBe(AlertManager.AlertStatus.SILENCED);
    
    // 取消静默
    const unsilenced = alertManager.unsilence(silenceId);
    
    expect(unsilenced).toBe(true);
    expect(alertManager.silencedAlerts.has(silenceId)).toBe(false);
    
    // 告警应该恢复活跃状态
    const alert = alertManager.alerts.get(alertName);
    expect(alert.status).toBe(AlertManager.AlertStatus.ACTIVE);
    expect(alert.silencedBy).toBeUndefined();
  });

  test('应该能添加告警规则', () => {
    // 添加一个始终触发的规则
    const ruleName = 'always_trigger';
    alertManager.addRule({
      name: ruleName,
      condition: () => Promise.resolve(true),
      message: 'Test rule triggered',
      severity: AlertManager.AlertSeverity.INFO,
      checkInterval: 1000 // 1秒检查一次
    });
    
    expect(alertManager.rules.has(ruleName)).toBe(true);
    const rule = alertManager.rules.get(ruleName);
    expect(rule.name).toBe(ruleName);
    expect(rule.enabled).toBe(true);
  });

  test('应该能添加指标阈值告警规则', () => {
    // 添加一个指标阈值规则
    const ruleName = 'metric_threshold';
    const metricFn = jest.fn().mockResolvedValue(95);
    
    alertManager.addMetricRule({
      name: ruleName,
      metricFn,
      comparison: '>',
      threshold: 90,
      severity: AlertManager.AlertSeverity.WARNING
    });
    
    expect(alertManager.rules.has(ruleName)).toBe(true);
    const rule = alertManager.rules.get(ruleName);
    expect(rule.name).toBe(ruleName);
    
    // 验证条件函数
    expect(typeof rule.condition).toBe('function');
  });

  test('应该能限制告警历史记录大小', () => {
    // 创建一个小历史记录大小的告警管理器
    const smallAlertManager = new AlertManager({
      maxHistorySize: 3
    });
    
    // 添加5个告警
    smallAlertManager.alert('alert1', 'Message 1');
    smallAlertManager.alert('alert2', 'Message 2');
    smallAlertManager.alert('alert3', 'Message 3');
    smallAlertManager.alert('alert4', 'Message 4');
    smallAlertManager.alert('alert5', 'Message 5');
    
    // 历史记录应该被限制为3个
    expect(smallAlertManager.alertHistory.length).toBe(3);
    
    // 应该保留最新的告警
    const names = smallAlertManager.alertHistory.map(a => a.name);
    expect(names).toContain('alert5');
    expect(names).toContain('alert4');
    expect(names).toContain('alert3');
    expect(names).not.toContain('alert2');
    expect(names).not.toContain('alert1');
  });

  test('应该能添加和使用通知器', async () => {
    const notifyMock = jest.fn().mockResolvedValue(true);
    
    // 添加测试通知器
    alertManager.addNotifier({
      name: 'test_notifier',
      notify: notifyMock,
      filter: (alert) => alert.severity === AlertManager.AlertSeverity.CRITICAL
    });
    
    // 触发不同级别的告警
    alertManager.alert('warning_alert', 'Warning message', AlertManager.AlertSeverity.WARNING);
    alertManager.alert('critical_alert', 'Critical message', AlertManager.AlertSeverity.CRITICAL);
    
    // 等待通知处理完成
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // 只应该通知严重级别的告警
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0][0].name).toBe('critical_alert');
  });

  test('应该能正确过滤告警历史', () => {
    // 添加不同级别和状态的告警
    alertManager.alert('info', 'Info message', AlertManager.AlertSeverity.INFO);
    alertManager.alert('warning', 'Warning message', AlertManager.AlertSeverity.WARNING);
    alertManager.alert('error', 'Error message', AlertManager.AlertSeverity.ERROR);
    alertManager.alert('critical', 'Critical message', AlertManager.AlertSeverity.CRITICAL);
    
    // 解决其中一个告警
    alertManager.resolve('info');
    
    // 确认其中一个告警
    alertManager.acknowledge('warning', 'test_user');
    
    // 过滤不同级别的告警
    const errorAlerts = alertManager.getAlertHistory({ severity: AlertManager.AlertSeverity.ERROR });
    expect(errorAlerts.length).toBe(1);
    expect(errorAlerts[0].name).toBe('error');
    
    // 过滤不同状态的告警
    const resolvedAlerts = alertManager.getAlertHistory({ status: AlertManager.AlertStatus.RESOLVED });
    expect(resolvedAlerts.length).toBe(1);
    expect(resolvedAlerts[0].name).toBe('info');
    
    const acknowledgedAlerts = alertManager.getAlertHistory({ status: AlertManager.AlertStatus.ACKNOWLEDGED });
    expect(acknowledgedAlerts.length).toBe(1);
    expect(acknowledgedAlerts[0].name).toBe('warning');
  });

  afterAll(() => {
    // 清理告警管理器
    if (alertManager) {
      alertManager.shutdown();
    }

    // 确保所有测试中创建的AlertManager实例都被清理
    jest.restoreAllMocks();
  });


});