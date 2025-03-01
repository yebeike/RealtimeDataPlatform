// 文件位置: tests/mocks/auth.js

// 模拟认证中间件
module.exports = (requiredRight) => (req, res, next) => {
    // 在测试中不验证权限，直接放行
    req.user = { role: 'admin' };
    next();
  };