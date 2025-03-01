// 文件位置: src/utils/monitoring/AlertManager.js

const EventEmitter = require('events');
const logger = require('../../config/logger');

/**
 * 告警级别枚举
 */
const AlertSeverity = {
  INFO: 'info',         // 信息级别，只是通知无需立即处理
  WARNING: 'warning',   // 警告级别，可能需要关注
  ERROR: 'error',       // 错误级别，需要处理
  CRITICAL: 'critical'  // 严重级别，需要立即处理
};

/**
 * 告警状态枚举
 */
const AlertStatus = {
  ACTIVE: 'active',       // 活跃的告警
  RESOLVED: 'resolved',   // 已解决的告警
  ACKNOWLEDGED: 'acknowledged', // 已确认但未解决的告警
  SILENCED: 'silenced'    // 已静默的告警
};

/**
 * 告警管理器 - 负责触发、管理和通知系统告警
 */
class AlertManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.alerts = new Map(); // 当前活跃的告警
    this.alertHistory = []; // 历史告警记录
    this.rules = new Map(); // 告警规则
    this.notifiers = []; // 通知通道
    this.silencedAlerts = new Map(); // 静默的告警
    this.maxHistorySize = options.maxHistorySize || 1000; // 历史记录最大数量
    this.enabled = options.enabled !== false;
    
    // 默认添加日志通知器
    this.addNotifier({
      name: 'logger',
      notify: (alert) => {
        const logLevel = this._severityToLogLevel(alert.severity);
        logger[logLevel](
          `[ALERT] ${alert.name}${alert.labels.length ? ` [${alert.labels.join(',')}]` : ''}: ${alert.message}`
        );
        return Promise.resolve();
      }
    });
  }
  
  /**
   * 添加一个告警规则
   * @param {Object} rule 告警规则配置
   * @param {string} rule.name 规则名称
   * @param {Function} rule.condition 条件函数，返回true则触发告警
   * @param {string} rule.message 告警消息模板
   * @param {string} rule.severity 告警级别
   * @param {Array<string>} rule.labels 告警标签
   * @param {number} rule.checkInterval 检查间隔(ms)
   * @param {number} rule.autoResolveAfter 自动解决时间(ms)，0表示不自动解决
   * @returns {AlertManager} 当前实例，便于链式调用
   */
  addRule(rule) {
    if (!rule.name || typeof rule.condition !== 'function') {
      throw new Error('Rule must have name and condition function');
    }
    
    const newRule = {
      name: rule.name,
      condition: rule.condition,
      message: rule.message || '${name} alert triggered',
      severity: rule.severity || AlertSeverity.WARNING,
      labels: rule.labels || [],
      checkInterval: rule.checkInterval || 60000, // 默认1分钟检查一次
      autoResolveAfter: rule.autoResolveAfter || 0, // 默认不自动解决
      lastCheck: null,
      timer: null,
      enabled: true
    };
    
    this.rules.set(rule.name, newRule);
    
    // 如果告警管理器启用，则立即开始检查
    if (this.enabled) {
      this._startRuleCheck(newRule);
    }
    
    logger.debug(`Added alert rule: ${rule.name}`);
    return this;
  }
  
  /**
   * 添加指标阈值告警规则
   * @param {Object} options 规则配置
   * @param {string} options.name 规则名称
   * @param {Function} options.metricFn 获取指标值的函数
   * @param {string} options.comparison 比较操作 ('>', '<', '>=', '<=', '==', '!=')
   * @param {number} options.threshold 阈值
   * @param {string} options.severity 告警级别
   * @param {string} options.message 告警消息模板
   * @returns {AlertManager} 当前实例，便于链式调用
   */
  addMetricRule(options) {
    const { name, metricFn, comparison, threshold, severity, message } = options;
    
    // 验证参数
    if (typeof metricFn !== 'function') {
      throw new Error('metricFn must be a function');
    }
    
    // 创建比较函数
    let compareFunc;
    switch (comparison) {
      case '>':
        compareFunc = (value) => value > threshold;
        break;
      case '<':
        compareFunc = (value) => value < threshold;
        break;
      case '>=':
        compareFunc = (value) => value >= threshold;
        break;
      case '<=':
        compareFunc = (value) => value <= threshold;
        break;
      case '==':
        compareFunc = (value) => value === threshold;
        break;
      case '!=':
        compareFunc = (value) => value !== threshold;
        break;
      default:
        throw new Error(`Invalid comparison operator: ${comparison}`);
    }
    
    // 创建条件函数
    const condition = async () => {
      try {
        const value = await metricFn();
        const result = compareFunc(value);
        if (result) {
          // 添加额外的告警数据
          return {
            triggered: true,
            value,
            threshold,
            comparison
          };
        }
        return { triggered: false };
      } catch (error) {
        logger.error(`Error checking metric for rule ${name}:`, error);
        return { triggered: false, error: error.message };
      }
    };
    
    // 构建默认消息
    const defaultMessage = `Metric alert: value ${comparison} ${threshold}`;
    
    // 添加规则
    return this.addRule({
      name,
      condition,
      message: message || defaultMessage,
      severity: severity || AlertSeverity.WARNING,
      labels: ['metric'],
      ...options
    });
  }
  
  /**
   * 添加健康检查告警规则
   * @param {Object} healthChecker 健康检查器实例
   * @param {Object} options 规则配置
   * @returns {AlertManager} 当前实例，便于链式调用
   */
  addHealthCheckRule(healthChecker, options = {}) {
    // 监听健康检查失败事件
    healthChecker.on('health:check:failure', ({ name, error }) => {
      const component = healthChecker.getComponentStatus(name);
      
      // 如果组件是关键组件，使用更高级别的告警
      const severity = component.critical 
        ? AlertSeverity.CRITICAL 
        : AlertSeverity.ERROR;
      
      this.alert(
        `health_check_${name}`,
        `Health check failed for ${name}: ${error}`,
        severity,
        ['health_check', name]
      );
    });
    
    // 监听健康检查成功事件
    healthChecker.on('health:check:success', ({ name }) => {
      // 解决之前的告警
      this.resolve(`health_check_${name}`);
    });
    
    // 监听整体状态变化
    healthChecker.on('health:check:complete', (status) => {
      if (status.status === 'unhealthy') {
        this.alert(
          'system_health',
          'System is unhealthy',
          AlertSeverity.CRITICAL,
          ['system_health']
        );
      } else if (status.status === 'degraded') {
        this.alert(
          'system_health',
          'System is in degraded state',
          AlertSeverity.WARNING,
          ['system_health']
        );
      } else {
        this.resolve('system_health');
      }
    });
    
    logger.debug('Added health check alert rules');
    return this;
  }
  
  /**
   * 添加一个告警通知器
   * @param {Object} notifier 通知器配置
   * @param {string} notifier.name 通知器名称
   * @param {Function} notifier.notify 通知函数，接收alert对象，返回Promise
   * @param {Function} notifier.filter 过滤函数，返回true则发送通知
   * @returns {AlertManager} 当前实例，便于链式调用
   */
  addNotifier(notifier) {
    if (!notifier.name || typeof notifier.notify !== 'function') {
      throw new Error('Notifier must have name and notify function');
    }
    
    this.notifiers.push({
      name: notifier.name,
      notify: notifier.notify,
      filter: notifier.filter || (() => true)
    });
    
    logger.debug(`Added alert notifier: ${notifier.name}`);
    return this;
  }
  
  /**
   * 添加邮件通知器
   * @param {Object} options 邮件配置
   * @param {Object} emailTransport 邮件传输对象
   * @returns {AlertManager} 当前实例，便于链式调用
   */
  addEmailNotifier(options, emailTransport) {
    return this.addNotifier({
      name: 'email',
      filter: (alert) => {
        // 默认只发送ERROR和CRITICAL级别的告警
        return [AlertSeverity.ERROR, AlertSeverity.CRITICAL].includes(alert.severity);
      },
      notify: async (alert) => {
        try {
          const subject = `[${alert.severity.toUpperCase()}] ${alert.name} Alert`;
          const message = `
            <h2>Alert: ${alert.name}</h2>
            <p><strong>Severity:</strong> ${alert.severity}</p>
            <p><strong>Status:</strong> ${alert.status}</p>
            <p><strong>Time:</strong> ${new Date(alert.timestamp).toISOString()}</p>
            <p><strong>Message:</strong> ${alert.message}</p>
            ${alert.labels.length ? `<p><strong>Labels:</strong> ${alert.labels.join(', ')}</p>` : ''}
            ${alert.data ? `<p><strong>Data:</strong> <pre>${JSON.stringify(alert.data, null, 2)}</pre></p>` : ''}
          `;
          
          await emailTransport.sendMail({
            from: options.from,
            to: options.to,
            subject,
            html: message
          });
          
          return true;
        } catch (error) {
          logger.error('Failed to send email notification:', error);
          return false;
        }
      }
    });
  }
  
  /**
   * 添加Slack通知器
   * @param {Object} options Slack配置
   * @returns {AlertManager} 当前实例，便于链式调用
   */
  addSlackNotifier(options) {
    return this.addNotifier({
      name: 'slack',
      filter: (alert) => {
        // 默认只发送WARNING及以上级别的告警
        return [
          AlertSeverity.WARNING, 
          AlertSeverity.ERROR, 
          AlertSeverity.CRITICAL
        ].includes(alert.severity);
      },
      notify: async (alert) => {
        try {
          const color = this._severityToColor(alert.severity);
          
          const payload = {
            attachments: [{
              color,
              title: `[${alert.severity.toUpperCase()}] ${alert.name}`,
              text: alert.message,
              fields: [
                {
                  title: 'Severity',
                  value: alert.severity,
                  short: true
                },
                {
                  title: 'Status',
                  value: alert.status,
                  short: true
                },
                {
                  title: 'Time',
                  value: new Date(alert.timestamp).toISOString(),
                  short: true
                }
              ],
              footer: 'Realtime Data Platform'
            }]
          };
          
          // 如果有标签，添加标签字段
          if (alert.labels.length) {
            payload.attachments[0].fields.push({
              title: 'Labels',
              value: alert.labels.join(', '),
              short: true
            });
          }
          
          // 如果有数据，添加数据字段
          if (alert.data) {
            payload.attachments[0].fields.push({
              title: 'Data',
              value: '```' + JSON.stringify(alert.data, null, 2) + '```',
              short: false
            });
          }
          
          const response = await fetch(options.webhookUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
          });
          
          if (!response.ok) {
            throw new Error(`Slack API returned ${response.status}: ${await response.text()}`);
          }
          
          return true;
        } catch (error) {
          logger.error('Failed to send Slack notification:', error);
          return false;
        }
      }
    });
  }
  
  /**
   * 启用规则检查
   * @param {string} ruleName 规则名称
   */
  enableRule(ruleName) {
    const rule = this.rules.get(ruleName);
    if (rule) {
      rule.enabled = true;
      this._startRuleCheck(rule);
      logger.debug(`Enabled alert rule: ${ruleName}`);
    }
  }
  
  /**
   * 禁用规则检查
   * @param {string} ruleName 规则名称
   */
  disableRule(ruleName) {
    const rule = this.rules.get(ruleName);
    if (rule) {
      rule.enabled = false;
      this._stopRuleCheck(rule);
      logger.debug(`Disabled alert rule: ${ruleName}`);
    }
  }
  
  /**
   * 手动触发告警
   * @param {string} name 告警名称
   * @param {string} message 告警消息
   * @param {string} severity 告警级别
   * @param {Array<string>} labels 告警标签
   * @param {Object} data 相关数据
   * @returns {Object} 创建的告警对象
   */
  alert(name, message, severity = AlertSeverity.WARNING, labels = [], data = null) {
    // 检查是否已静默
    if (this._isSilenced(name, labels)) {
      logger.debug(`Alert ${name} is silenced, not triggering`);
      return null;
    }
    
    // 创建告警对象
    const alert = {
      id: `${name}_${Date.now()}`,
      name,
      message,
      severity,
      labels,
      data,
      status: AlertStatus.ACTIVE,
      timestamp: Date.now(),
      lastUpdated: Date.now(),
      notifications: []
    };
    
    // 存储活跃告警
    this.alerts.set(name, alert);
    
    // 添加到历史记录
    this._addToHistory(alert);
    
    // 发送通知
    this._sendNotifications(alert);
    
    // 触发事件
    this.emit('alert', alert);
    
    logger.debug(`Triggered alert: ${name} [${severity}]`);
    return alert;
  }
  
  /**
   * 解决告警
   * @param {string} name 告警名称
   * @param {string} message 解决消息
   * @returns {boolean} 是否成功解决
   */
  resolve(name, message = null) {
    const alert = this.alerts.get(name);
    if (!alert) {
      return false;
    }
    
    // 更新告警状态
    alert.status = AlertStatus.RESOLVED;
    alert.lastUpdated = Date.now();
    alert.resolvedAt = Date.now();
    
    if (message) {
      alert.resolveMessage = message;
    }
    
    // 从活跃告警中移除
    this.alerts.delete(name);
    
    // 更新历史记录
    this._updateAlertHistory(alert);
    
    // 触发事件
    this.emit('resolve', alert);
    
    logger.debug(`Resolved alert: ${name}`);
    return true;
  }
  
  /**
   * 确认告警
   * @param {string} name 告警名称
   * @param {string} acknowledgedBy 确认人
   * @param {string} message 确认消息
   * @returns {boolean} 是否成功确认
   */
  acknowledge(name, acknowledgedBy, message = null) {
    const alert = this.alerts.get(name);
    if (!alert) {
      return false;
    }
    
    // 更新告警状态
    alert.status = AlertStatus.ACKNOWLEDGED;
    alert.lastUpdated = Date.now();
    alert.acknowledgedAt = Date.now();
    alert.acknowledgedBy = acknowledgedBy;
    
    if (message) {
      alert.acknowledgeMessage = message;
    }
    
    // 更新历史记录
    this._updateAlertHistory(alert);
    
    // 触发事件
    this.emit('acknowledge', alert);
    
    logger.debug(`Acknowledged alert: ${name} by ${acknowledgedBy}`);
    return true;
  }
  
  /**
   * 静默告警
   * @param {string} name 告警名称
   * @param {number} duration 静默持续时间(ms)，0表示永久静默
   * @param {Array<string>} labels 标签匹配，留空表示匹配所有
   * @param {string} silencedBy 静默人
   * @param {string} message 静默原因
   * @returns {string} 静默ID
   */
  silence(name, duration = 0, labels = [], silencedBy = 'system', message = null) {
    const silenceId = `${name}_${Date.now()}`;
    const expireAt = duration > 0 ? Date.now() + duration : 0;
    
    // 创建静默对象
    const silence = {
      id: silenceId,
      name,
      labels,
      createdAt: Date.now(),
      expireAt,
      silencedBy,
      message
    };
    
    // 存储静默
    this.silencedAlerts.set(silenceId, silence);
    
    // 如果有持续时间，设置定时器
    if (duration > 0) {
      setTimeout(() => {
        this.unsilence(silenceId);
      }, duration);
    }
    
    // 如果当前有匹配的活跃告警，标记为静默
    const alert = this.alerts.get(name);
    if (alert && this._labelMatch(alert.labels, labels)) {
      alert.status = AlertStatus.SILENCED;
      alert.silencedBy = silenceId;
      alert.lastUpdated = Date.now();
      
      // 更新历史记录
      this._updateAlertHistory(alert);
      
      // 触发事件
      this.emit('silence', { alert, silence });
    } else {
      // 只触发静默事件
      this.emit('silence', { silence });
    }
    
    logger.debug(`Silenced alert: ${name} for ${duration}ms by ${silencedBy}`);
    return silenceId;
  }
  
  /**
   * 取消静默
   * @param {string} silenceId 静默ID
   * @returns {boolean} 是否成功取消
   */
  unsilence(silenceId) {
    const silence = this.silencedAlerts.get(silenceId);
    if (!silence) {
      return false;
    }
    
    // 移除静默
    this.silencedAlerts.delete(silenceId);
    
    // 查找受此静默影响的告警
    for (const [name, alert] of this.alerts.entries()) {
      if (alert.silencedBy === silenceId) {
        // 恢复告警状态
        delete alert.silencedBy;
        alert.status = AlertStatus.ACTIVE;
        alert.lastUpdated = Date.now();
        
        // 更新历史记录
        this._updateAlertHistory(alert);
      }
    }
    
    // 触发事件
    this.emit('unsilence', silence);
    
    logger.debug(`Unsilenced alert: ${silence.name} (ID: ${silenceId})`);
    return true;
  }
  
  /**
   * 获取所有活跃告警
   * @returns {Array} 告警数组
   */
  getActiveAlerts() {
    return Array.from(this.alerts.values());
  }
  
  /**
   * 获取告警历史
   * @param {Object} options 筛选选项
   * @param {number} options.limit 限制数量
   * @param {string} options.severity 按严重级别筛选
   * @param {string} options.status 按状态筛选
   * @param {string} options.name 按名称筛选
   * @returns {Array} 告警历史数组
   */
  getAlertHistory(options = {}) {
    let history = [...this.alertHistory];
    
    // 按名称筛选
    if (options.name) {
      history = history.filter(alert => alert.name === options.name);
    }
    
    // 按严重级别筛选
    if (options.severity) {
      history = history.filter(alert => alert.severity === options.severity);
    }
    
    // 按状态筛选
    if (options.status) {
      history = history.filter(alert => alert.status === options.status);
    }
    
    // 按时间范围筛选
    if (options.startTime && options.endTime) {
      history = history.filter(alert => 
        alert.timestamp >= options.startTime && alert.timestamp <= options.endTime
      );
    } else if (options.startTime) {
      history = history.filter(alert => alert.timestamp >= options.startTime);
    } else if (options.endTime) {
      history = history.filter(alert => alert.timestamp <= options.endTime);
    }
    
    // 排序和限制
    history.sort((a, b) => b.timestamp - a.timestamp);
    
    if (options.limit && options.limit > 0) {
      history = history.slice(0, options.limit);
    }
    
    return history;
  }
  
  /**
   * 开始一个规则的检查
   * @private
   * @param {Object} rule 规则对象
   */
  _startRuleCheck(rule) {
    // 如果已有定时器，先停止
    this._stopRuleCheck(rule);
    
    // 设置定时器
    rule.timer = setInterval(async () => {
      try {
        rule.lastCheck = Date.now();
        const result = await rule.condition();
        
        if (result && (result === true || result.triggered === true)) {
          // 构建消息
          let message = rule.message;
          if (typeof message === 'function') {
            message = message(result);
          }
          
          // 触发告警
          this.alert(rule.name, message, rule.severity, rule.labels, result === true ? null : result);
        } else if (this.alerts.has(rule.name)) {
          // 如果条件不再满足，但有活跃告警，则解决它
          this.resolve(rule.name, 'Condition no longer met');
        }
      } catch (error) {
        logger.error(`Error checking alert rule ${rule.name}:`, error);
      }
    }, rule.checkInterval);
    
    logger.debug(`Started checking alert rule: ${rule.name} (every ${rule.checkInterval}ms)`);
  }
  
  /**
   * 停止一个规则的检查
   * @private
   * @param {Object} rule 规则对象
   */
  _stopRuleCheck(rule) {
    if (rule.timer) {
      clearInterval(rule.timer);
      rule.timer = null;
      logger.debug(`Stopped checking alert rule: ${rule.name}`);
    }
  }
  
  /**
   * 发送告警通知
   * @private
   * @param {Object} alert 告警对象
   */
  async _sendNotifications(alert) {
    for (const notifier of this.notifiers) {
      try {
        // 检查过滤器
        if (typeof notifier.filter === 'function' && !notifier.filter(alert)) {
          continue;
        }
        
        // 发送通知
        const result = await notifier.notify(alert);
        
        // 记录通知结果
        alert.notifications.push({
          notifier: notifier.name,
          time: Date.now(),
          success: !!result
        });
      } catch (error) {
        logger.error(`Error sending notification via ${notifier.name}:`, error);
        
        // 记录通知失败
        alert.notifications.push({
          notifier: notifier.name,
          time: Date.now(),
          success: false,
          error: error.message
        });
      }
    }
    
    // 更新历史记录
    this._updateAlertHistory(alert);
  }
  
  /**
   * 添加告警到历史记录
   * @private
   * @param {Object} alert 告警对象
   */
  _addToHistory(alert) {
    // 深拷贝以避免引用问题
    const historicalAlert = JSON.parse(JSON.stringify(alert));
    
    // 添加到历史记录
    this.alertHistory.unshift(historicalAlert);
    
    // 限制历史记录大小
    if (this.alertHistory.length > this.maxHistorySize) {
      this.alertHistory = this.alertHistory.slice(0, this.maxHistorySize);
    }
  }
  
  /**
   * 更新历史记录中的告警
   * @private
   * @param {Object} alert 告警对象
   */
  _updateAlertHistory(alert) {
    // 找到匹配的历史记录
    const index = this.alertHistory.findIndex(a => a.id === alert.id);
    if (index !== -1) {
      // 更新历史记录
      this.alertHistory[index] = JSON.parse(JSON.stringify(alert));
    } else {
      // 如果没找到，添加到历史记录
      this._addToHistory(alert);
    }
  }
  
  /**
   * 检查告警是否已静默
   * @private
   * @param {string} name 告警名称
   * @param {Array<string>} labels 告警标签
   * @returns {boolean} 是否静默
   */
  _isSilenced(name, labels) {
    for (const silence of this.silencedAlerts.values()) {
      // 检查名称是否匹配
      if (silence.name !== name && silence.name !== '*') {
        continue;
      }
      
      // 检查标签是否匹配
      if (silence.labels.length > 0 && !this._labelMatch(labels, silence.labels)) {
        continue;
      }
      
      // 检查是否过期
      if (silence.expireAt > 0 && silence.expireAt < Date.now()) {
        // 静默已过期，自动移除
        this.silencedAlerts.delete(silence.id);
        continue;
      }
      
      // 所有条件都满足，告警被静默
      return true;
    }
    
    return false;
  }
  
  /**
   * 检查标签是否匹配
   * @private
   * @param {Array<string>} alertLabels 告警标签
   * @param {Array<string>} matchLabels 匹配标签
   * @returns {boolean} 是否匹配
   */
  _labelMatch(alertLabels, matchLabels) {
    // 如果匹配标签为空，则匹配所有
    if (!matchLabels || matchLabels.length === 0) {
      return true;
    }
    
    // 检查是否包含所有匹配标签
    return matchLabels.every(label => alertLabels.includes(label));
  }
  
  /**
   * 严重级别转换为日志级别
   * @private
   * @param {string} severity 严重级别
   * @returns {string} 日志级别
   */
  _severityToLogLevel(severity) {
    switch (severity) {
      case AlertSeverity.CRITICAL:
      case AlertSeverity.ERROR:
        return 'error';
      case AlertSeverity.WARNING:
        return 'warn';
      case AlertSeverity.INFO:
      default:
        return 'info';
    }
  }
  
  /**
   * 严重级别转换为颜色
   * @private
   * @param {string} severity 严重级别
   * @returns {string} 颜色代码
   */
  _severityToColor(severity) {
    switch (severity) {
      case AlertSeverity.CRITICAL:
        return '#FF0000'; // 红色
      case AlertSeverity.ERROR:
        return '#FF9900'; // 橙色
      case AlertSeverity.WARNING:
        return '#FFCC00'; // 黄色
      case AlertSeverity.INFO:
      default:
        return '#36A2EB'; // 蓝色
    }
  }


  // AlertManager.js 文件，在类的末尾添加此方法，就在最后的 module.exports = AlertManager; 之前
  /**
   * 清理并关闭告警管理器
   */
  shutdown() {
    // 停止所有规则检查
    for (const rule of this.rules.values()) {
      this._stopRuleCheck(rule);
    }
    
    // 清理所有静默定时器
    for (const [silenceId, silence] of this.silencedAlerts.entries()) {
      // 如果有关联的计时器，清理它
      if (silence.timer) {
        clearTimeout(silence.timer);
        silence.timer = null;
      }
    }
    
    // 清空集合
    this.alerts.clear();
    this.silencedAlerts.clear();
    
    logger.info('Alert manager stopped');
  }

}



// 导出告警级别和状态枚举
AlertManager.AlertSeverity = AlertSeverity;
AlertManager.AlertStatus = AlertStatus;


module.exports = AlertManager;