/**
 * 测试数据生成器
 * 用于生成模拟数据以测试数据处理系统
 */

// 生成随机整数
const randomInt = (min, max) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  };
  
  // 生成随机日期
  const randomDate = (start, end) => {
    return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
  };
  
  // 从数组中随机选择一项
  const randomChoice = (array) => {
    return array[Math.floor(Math.random() * array.length)];
  };
  
  /**
   * 生成模拟用户活动数据
   * @param {number} count - 要生成的数据条数
   * @returns {Array<Object>} - 生成的数据数组
   */
  const generateUserActivityData = (count = 100) => {
    const actions = ['login', 'logout', 'view_page', 'click_button', 'submit_form', 'purchase'];
    const pages = ['home', 'product', 'cart', 'checkout', 'profile', 'settings'];
    const userIds = Array(20).fill(0).map((_, i) => `user_${i+1}`);
    
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setHours(startDate.getHours() - 24); // 过去24小时的数据
    
    return Array(count).fill(0).map(() => {
      const userId = randomChoice(userIds);
      const action = randomChoice(actions);
      const timestamp = randomDate(startDate, endDate);
      
      const baseData = {
        ts: timestamp.toISOString(),
        uid: userId,
        act: action,
        ip: `192.168.${randomInt(1, 255)}.${randomInt(1, 255)}`,
        ua: randomChoice([
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          'Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X)',
          'Mozilla/5.0 (Linux; Android 11; SM-G998B)'
        ]),
        type: 'user-activity'
      };
      
      // 根据不同的操作添加特定字段
      switch (action) {
        case 'view_page':
          return {
            ...baseData,
            page: randomChoice(pages),
            duration: randomInt(5, 300) // 5-300秒
          };
        case 'click_button':
          return {
            ...baseData,
            page: randomChoice(pages),
            button: randomChoice(['buy_now', 'add_to_cart', 'subscribe', 'submit', 'cancel'])
          };
        case 'purchase':
          return {
            ...baseData,
            amount: randomInt(10, 1000) / 10, // 1.0 - 100.0
            items: randomInt(1, 5)
          };
        default:
          return baseData;
      }
    });
  };
  
  /**
   * 生成模拟系统指标数据
   * @param {number} count - 要生成的数据条数
   * @returns {Array<Object>} - 生成的数据数组
   */
  const generateSystemMetricsData = (count = 100) => {
    const metrics = ['cpu_usage', 'memory_usage', 'disk_usage', 'network_in', 'network_out', 'response_time'];
    const hosts = ['server-01', 'server-02', 'server-03', 'server-04'];
    
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setHours(startDate.getHours() - 1); // 过去1小时的数据
    
    return Array(count).fill(0).map(() => {
      const metric = randomChoice(metrics);
      const timestamp = randomDate(startDate, endDate);
      
      // 根据指标类型生成合理的值
      let value;
      switch (metric) {
        case 'cpu_usage':
          value = randomInt(1, 100); // 1-100%
          break;
        case 'memory_usage':
          value = randomInt(10, 95); // 10-95%
          break;
        case 'disk_usage':
          value = randomInt(20, 90); // 20-90%
          break;
        case 'network_in':
        case 'network_out':
          value = randomInt(100, 10000); // 100-10000 KB/s
          break;
        case 'response_time':
          value = randomInt(10, 2000); // 10-2000 ms
          break;
        default:
          value = randomInt(1, 100);
      }
      
      return {
        timestamp: timestamp.toISOString(),
        metric,
        value,
        host: randomChoice(hosts),
        type: 'system-metrics'
      };
    });
  };
  
  /**
   * 生成异常系统指标数据
   * @param {number} count - 要生成的数据条数
   * @returns {Array<Object>} - 生成的数据数组
   */
  const generateAnomalyMetricsData = (count = 10) => {
    const metrics = ['cpu_usage', 'memory_usage', 'response_time'];
    const hosts = ['server-01', 'server-02', 'server-03', 'server-04'];
    
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setMinutes(startDate.getMinutes() - 30); // 过去30分钟的数据
    
    return Array(count).fill(0).map(() => {
      const metric = randomChoice(metrics);
      const timestamp = randomDate(startDate, endDate);
      
      // 生成异常值 - 远高于正常范围
      let value;
      switch (metric) {
        case 'cpu_usage':
          value = randomInt(95, 100); // 95-100%（高CPU使用率）
          break;
        case 'memory_usage':
          value = randomInt(95, 100); // 95-100%（高内存使用率）
          break;
        case 'response_time':
          value = randomInt(5000, 10000); // 5000-10000 ms（高响应时间）
          break;
        default:
          value = randomInt(90, 100);
      }
      
      return {
        timestamp: timestamp.toISOString(),
        metric,
        value,
        host: randomChoice(hosts),
        type: 'system-metrics'
      };
    });
  };
  
  module.exports = {
    generateUserActivityData,
    generateSystemMetricsData,
    generateAnomalyMetricsData
  };
  