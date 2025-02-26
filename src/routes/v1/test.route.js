const express = require('express');
const cache = require('../../utils/cache');
const router = express.Router();

// 测试缓存设置
router.post('/cache', async (req, res) => {
    try {
        const { key, value } = req.body;
        await cache.set(key, value);
        res.json({ message: '缓存设置成功' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 测试缓存获取
router.get('/cache/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const value = await cache.get(key);
        res.json({ value });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;