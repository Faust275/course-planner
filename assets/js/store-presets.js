/* ==========================================================
 * Store 静态规则与预设数据目录 (store-presets.js)
 * ----------------------------------------------------------
 * 从 store.js 拆出的纯配置/静态目录数据（番茄钟与卡池规则、树种图鉴、
 * 10 大类标签预设、成就定义与等级配置），无 DOM 依赖，在 store.js 之前加载。
 * ========================================================== */
(function (global) {
  'use strict';

  /* ===== 番茄钟 / 积分 / 养树：规则与树阶段 ===== */
  var POMO = {
    POINT_PER_MIN: 0.1,    // 每专注 1 分钟（整体下调到原 1/10）
    TASK_DONE: 1,          // 完成一个待办
    PLAN_CHECKIN: 0.2,     // 完成一次打卡
    PLAN_DONE: 3,          // 完成一个计划
    GOAL_DONE: 6,          // 目标推进到 100% 并归档留档（每目标一次，周期需满 7 天）
    KR_DONE: 1.5,          // 单条 KR 首次达成 100%（每 KR 一次）
    /* —— 记录类发分（睡眠 / 饮食 / 活动）：本轮移除积分 —— */
    SLEEP_DAY: 0,          // 每天首条睡眠记录（已移除积分）
    MEAL_EACH: 0,          // 每餐（已移除积分）
    MEAL_MAX_DAY: 3,       // 每天封顶几餐（仅记录用）
    ACTIVITY_PER_MIN: 0,   // 活动每分钟积分（已移除积分）
    ACTIVITY_MAX_DAY: 60,   // 活动每天积分上限（仅记录用）
    PLANT_COST: 10,        // 第一棵树（种树花费整体 ×0.1）
    PLANT_STEP: 3,         // 每多一棵，价格递增
    WATER_COST: 2,         // 浇一次水
    /* —— 抽卡机制 —— */
    JADE_PER_POINT: 180,   // 1 积分 = 180 合成玉（PULL_COST 仍为 600，故单抽 ≈ 3.33 积分）
    PULL_COST: 600,        // 单抽 600 合成玉（≈ 3.33 积分）
    TEN_COST: 6000,        // 十连 6000 合成玉（= 10 积分）
    RATE_6: 2,             // 六星基础概率 %
    RATE_5: 8,
    RATE_4: 50,
    PITY_START: 50,        // 50 抽后概率递增
    PITY_STEP: 2,          // 每抽 +2%
    TEN_GUARANTEE: 5,      // 十连保底至少五星
    POT_MAX: 5,            // 潜能上限（干员最多 6 份复制，潜能 0~5）
    DUP_POINTS: { 6: 10, 5: 3, 4: 0.5, 3: 0.2 },  // 满潜能后，每多抽一份转化的积分（按星级，可再换成合成玉）
    /* —— 专注 —— */
    FOCUS_REWARD: 10,      // 一次合格专注固定给的养分（积分）
    FOCUS_MIN_MIN: 40,     // 计入奖励的最短专注分钟（≥40 才算）
    FOCUS_REMIND_MIN: 60,  // 专注满 60 分钟提醒起来走走

    /* —— 种树 —— */
    GROVE_SLOTS: 4,        // 树位上限（固定 4）
    REVIVE_COST: 5,        // 复活枯桩消耗的养分

    /* —— 商城 —— */
    CARD_PRICE: 300,       // 月卡售价（森林积分）
    CARD_PRICE_GACHA: 54000, // 月卡售价（抽卡模式，合成玉；占位数值，待定）
    CARD_DAYS: 30,         // 月卡有效天数
    CARD_DAILY: 25,        // 每天用任意功能返还的积分（30 天全勤总返还约为售价的 3 倍）
    CARD_WEEK_BONUS: 25,   // 滚动 7 天全勤的额外奖励（券由全勤统一发，见 settleStreak）
    CARD_FULL_BONUS: 50,   // 30 天全勤的额外奖励（另发 1 张定向券）
    /* —— 有效动作 / 全勤 / 摸鱼券 —— */
    VALID_DAY_MIN: 2,      // 一天算「有效日」所需的最少有效动作次数
    GROWTH_PER_TICKET: 10, // 成长值满 10 换 1 张摸鱼券（重度动作 2 分，轻度 1 分 → 5 次合格专注 = 1 张）
    FISH_MAX_PER_WEEK: 5,  // 摸鱼券：滚动 7 天内最多用 5 张
    FISH_HOLD_MAX: 20,     // 摸鱼券持有上限
    STREAK_WEEK_POINTS: 5, // 连续 7 个有效日：人人可得的积分
    STREAK_MONTH_POINTS: 20, // 连续 30 个有效日：人人可得的积分

    /* —— 限定获取通道 —— */
    LIMITED_SPARK: 200,    // 限定井：累计抽数达到可直接兑换登记的限定（双井并计，但不叠加）

    /* —— 卡池（配置驱动：新增干员只改 ak_ops.js 的 poolTag；新增池只改这里）—— */
    GACHA_EPOCH: '2026-01-01',   // 轮换基准日：期号按绝对日期算，跨设备一致
    GACHA_POOLS: {
      standard: {
        id: 'standard', name: '标准寻访', tag: 'std',
        rotDays: 3, up6: 2, up5: 3, spark: 120, sparkHistory: 5, offLimited: 0.15,
        desc: '常规干员轮换 UP；歪出的是本池其他干员，另有低概率歪到限定'
      },
      classic: {
        id: 'classic', name: '中坚寻访', tag: 'classic',
        rotDays: 3, up6: 2, up5: 3, spark: 120, sparkHistory: 5, offLimited: 0.15,
        desc: '早期实装的老牌干员，独立计数，与标准寻访不互通'
      }
    }
  };

  /**
   * 树种：shape 决定树冠形态（round 圆冠 / cone 锥冠 / fan 扇形 / droop 垂枝 / palm 棕榈）
   * lastK：第 4→5 阶段需要记数（3~6，越珍稀越多）
   * bloom：成树时的花/果颜色（null 表示无）
   * unlockH：累计专注满多少小时解锁（0 = 初始可用）
   * info：图鉴资料卡（学名 / 科属 / 保护级别 / 一句话）
   */
  var TREE_SPECIES = [
    { key: 'camphor', name: '樟树', crown: '#4c8c4a', crown2: '#3f7d3d', trunk: '#7a5c3a', shape: 'round', lastK: 3, unlockH: 0, price: 10,
      info: { sci: 'Cinnamomum camphora', family: '樟科', protect: '常见', note: '常绿乔木，枝叶自带樟脑清香。' } },
    { key: 'ginkgo', name: '银杏', crown: '#f0c04a', crown2: '#dfa93a', trunk: '#8a6a45', shape: 'fan', lastK: 3, unlockH: 0, price: 13,
      info: { sci: 'Ginkgo biloba', family: '银杏科', protect: '国家一级', note: '活化石，扇形叶秋日金黄。' } },
    { key: 'maple', name: '枫树', crown: '#e0703c', crown2: '#c8542a', trunk: '#7a5c3a', shape: 'droop', lastK: 4, unlockH: 0, price: 16,
      info: { sci: 'Acer', family: '槭树科', protect: '常见', note: '掌状裂叶，秋来满树红霞。' } },
    { key: 'sakura', name: '樱花', crown: '#f2a3bd', crown2: '#e88aab', trunk: '#8a6a45', shape: 'round', lastK: 4, bloom: '#ffb3c8', unlockH: 0, price: 20,
      info: { sci: 'Prunus serrulata', family: '蔷薇科', protect: '常见', note: '春日繁花，落英如雪。' } },
    { key: 'pine', name: '松树', crown: '#3f7d4a', crown2: '#356b3f', trunk: '#6f5637', shape: 'cone', lastK: 3, unlockH: 0, price: 14,
      info: { sci: 'Pinus', family: '松科', protect: '常见', note: '四季常青，针叶成塔。' } },
    { key: 'birch', name: '白桦', crown: '#8fc46b', crown2: '#7bb45c', trunk: '#c9c2b6', shape: 'round', lastK: 3, unlockH: 0, price: 12,
      info: { sci: 'Betula platyphylla', family: '桦木科', protect: '常见', note: '白色树皮，林间如雪。' } },
    { key: 'oak', name: '橡树', crown: '#4a8f52', crown2: '#3d7f45', trunk: '#6f5637', shape: 'round', lastK: 4, unlockH: 0, price: 22,
      info: { sci: 'Quercus', family: '壳斗科', protect: '常见', note: '冠幅阔大，结实为橡子。' } },
    { key: 'plane', name: '梧桐', crown: '#7cb342', crown2: '#6aa83a', trunk: '#8a6a45', shape: 'round', lastK: 3, unlockH: 0, price: 18,
      info: { sci: 'Platanus', family: '悬铃木科', protect: '常见', note: '叶大荫浓，行道常见。' } },
    { key: 'willow', name: '垂柳', crown: '#9ccc65', crown2: '#7cb342', trunk: '#7a5c3a', shape: 'droop', lastK: 3, unlockH: 5, price: 16,
      info: { sci: 'Salix babylonica', family: '杨柳科', protect: '常见', note: '枝条低垂，临水依依。' } },
    { key: 'palm', name: '椰树', crown: '#5aa86a', crown2: '#3f8f52', trunk: '#8a6a45', shape: 'palm', lastK: 4, unlockH: 10, price: 20,
      info: { sci: 'Cocos nucifera', family: '棕榈科', protect: '常见', note: '羽状大叶，海滨剪影。' } },
    /* —— 珍稀（按累计专注时长解锁）—— */
    { key: 'metasequoia', name: '水杉', crown: '#5fa05a', crown2: '#477f45', trunk: '#8a5a3a', shape: 'cone', lastK: 5, unlockH: 10, price: 0,
      info: { sci: 'Metasequoia glyptostroboides', family: '柏科', protect: '国家一级', note: '活化石，1940 年代在湖北利川重新发现，曾以为早已灭绝。' } },
    { key: 'dove', name: '珙桐', crown: '#6a9e58', crown2: '#548a46', trunk: '#8a6a45', shape: 'fan', lastK: 5, bloom: '#f7f7f2', unlockH: 20, price: 0,
      info: { sci: 'Davidia involucrata', family: '蓝果树科', protect: '国家一级', note: '中国特有「鸽子树」，白色苞片似鸽翼，风起如群鸽振翅。' } },
    { key: 'taxus', name: '红豆杉', crown: '#3f7d45', crown2: '#2f6236', trunk: '#7a5c3a', shape: 'cone', lastK: 5, bloom: '#e53935', unlockH: 30, price: 0,
      info: { sci: 'Taxus', family: '红豆杉科', protect: '国家一级', note: '珍稀濒危，树皮可提取抗癌药物紫杉醇，须依法保护。' } },
    { key: 'liriodendron', name: '鹅掌楸', crown: '#7aa84a', crown2: '#639238', trunk: '#8a6a45', shape: 'fan', lastK: 5, bloom: '#f2d06b', unlockH: 40, price: 0,
      info: { sci: 'Liriodendron chinense', family: '木兰科', protect: '国家二级', note: '叶似马褂，又名马褂木，中国特有珍稀树种。' } },
    { key: 'manglietia', name: '华盖木', crown: '#4f8a4a', crown2: '#3d703a', trunk: '#7a5c3a', shape: 'round', lastK: 6, bloom: '#f4e3b0', unlockH: 60, price: 0,
      info: { sci: 'Manglietiastrum sinicum', family: '木兰科', protect: '国家一级', note: '云南特有，野生植株一度不足十株，极危。' } },
    { key: 'dracaena', name: '龙血树', crown: '#4a7d52', crown2: '#37613f', trunk: '#9a7a55', shape: 'palm', lastK: 6, bloom: '#c0392b', unlockH: 80, price: 0,
      info: { sci: 'Dracaena cinnabari', family: '天门冬科', protect: '易危', note: '索科特拉岛特有，伞状树冠，树脂殷红如「龙血」。' } },
    { key: 'carpinus', name: '普陀鹅耳枥', crown: '#5a9a5a', crown2: '#457d45', trunk: '#8a6a45', shape: 'round', lastK: 6, unlockH: 100, price: 0,
      info: { sci: 'Carpinus putoensis', family: '桦木科', protect: '国家一级', note: '全球仅一株野生，被称为「地球独子」。' } },
    { key: 'fir', name: '百山祖冷杉', crown: '#2f6b45', crown2: '#245538', trunk: '#6f5637', shape: 'cone', lastK: 6, unlockH: 150, price: 0,
      info: { sci: 'Abies beshanzuensis', family: '松科', protect: '国家一级', note: '全球野生不足十株，极度濒危的松科孑遗植物。' } }
  ];


  var TREE_STAGES = [
    { name: '—' },
    { name: '嫩芽' },
    { name: '幼苗' },
    { name: '小树' },
    { name: '大树' },
    { name: '参天' }
  ];

  /* ==========================================================
   * 标签图标 / 配色
   * ========================================================== */

  /**
   * 常用标签预设：标签名命中时自动套用图标与颜色。
   * 共 10 组（学习 / 生活 / 工作 / 健康 / 运动 / 娱乐 / 社交 / 出行 / 饮食 / 其他）。
   */
  var TAG_PRESETS = [
    /* —— 学习 —— */
    { g: '学习', name: '学习', icon: 'book', color: '#4f46e5' },
    { g: '学习', name: '学习/英语', icon: 'lang', color: '#0ea5e9' },
    { g: '学习', name: '学习/数学', icon: 'calc', color: '#8b5cf6' },
    { g: '学习', name: '学习/专业课', icon: 'cap', color: '#6366f1' },
    { g: '学习', name: '学习/阅读', icon: 'bookOpen', color: '#14b8a6' },
    { g: '学习', name: '学习/作业', icon: 'pen', color: '#f59e0b' },
    { g: '学习', name: '学习/实验', icon: 'flask', color: '#06b6d4' },
    { g: '学习', name: '学习/编程', icon: 'code', color: '#0f766e' },
    { g: '学习', name: '学习/背诵', icon: 'idea', color: '#7c3aed' },
    { g: '学习', name: '学习/考试', icon: 'target', color: '#dc2626' },
    /* —— 生活 —— */
    { g: '生活', name: '生活', icon: 'home', color: '#10b981' },
    { g: '生活', name: '生活/家务', icon: 'sparkle', color: '#84cc16' },
    { g: '生活', name: '生活/洗漱', icon: 'drop', color: '#38bdf8' },
    { g: '生活', name: '生活/通勤', icon: 'bus', color: '#0ea5e9' },
    { g: '生活', name: '生活/收纳', icon: 'box', color: '#f59e0b' },
    { g: '生活', name: '生活/宠物', icon: 'paw', color: '#f97316' },
    { g: '生活', name: '生活/购物', icon: 'cart', color: '#ec4899' },
    /* —— 工作 —— */
    { g: '工作', name: '工作', icon: 'briefcase', color: '#1e40af' },
    { g: '工作', name: '工作/会议', icon: 'people', color: '#2563eb' },
    { g: '工作', name: '工作/写稿', icon: 'pen', color: '#4f46e5' },
    { g: '工作', name: '工作/邮件', icon: 'mail', color: '#0ea5e9' },
    { g: '工作', name: '工作/汇报', icon: 'chart', color: '#7c3aed' },
    { g: '工作', name: '工作/实习', icon: 'laptop', color: '#0891b2' },
    /* —— 健康 —— */
    { g: '健康', name: '健康', icon: 'heart', color: '#ef4444' },
    { g: '健康', name: '健康/睡眠', icon: 'moon', color: '#6366f1' },
    { g: '健康', name: '健康/吃药', icon: 'pill', color: '#f43f5e' },
    { g: '健康', name: '健康/就医', icon: 'pill', color: '#e11d48' },
    { g: '健康', name: '健康/冥想', icon: 'leaf', color: '#22c55e' },
    /* —— 运动 —— */
    { g: '运动', name: '运动', icon: 'dumbbell', color: '#f97316' },
    { g: '运动', name: '运动/跑步', icon: 'heartbeat', color: '#ef4444' },
    { g: '运动', name: '运动/球类', icon: 'ball', color: '#16a34a' },
    { g: '运动', name: '运动/骑行', icon: 'bike', color: '#0891b2' },
    { g: '运动', name: '运动/拉伸', icon: 'heartbeat', color: '#14b8a6' },
    /* —— 娱乐 —— */
    { g: '娱乐', name: '娱乐', icon: 'game', color: '#a855f7' },
    { g: '娱乐', name: '娱乐/电影', icon: 'film', color: '#6366f1' },
    { g: '娱乐', name: '娱乐/音乐', icon: 'music', color: '#ec4899' },
    { g: '娱乐', name: '娱乐/追剧', icon: 'tv', color: '#8b5cf6' },
    { g: '娱乐', name: '娱乐/画画', icon: 'brush', color: '#f59e0b' },
    /* —— 社交 —— */
    { g: '社交', name: '社交', icon: 'people', color: '#0ea5e9' },
    { g: '社交', name: '社交/聚会', icon: 'gift', color: '#ec4899' },
    { g: '社交', name: '社交/聊天', icon: 'chat', color: '#38bdf8' },
    { g: '社交', name: '社交/电话', icon: 'phone', color: '#22c55e' },
    /* —— 出行 —— */
    { g: '出行', name: '出行', icon: 'plane', color: '#0284c7' },
    { g: '出行', name: '出行/旅行', icon: 'pin', color: '#f59e0b' },
    { g: '出行', name: '出行/自驾', icon: 'car', color: '#64748b' },
    /* —— 饮食 —— */
    { g: '饮食', name: '饮食', icon: 'food', color: '#f97316' },
    { g: '饮食', name: '饮食/早餐', icon: 'coffee', color: '#f59e0b' },
    { g: '饮食', name: '饮食/饮品', icon: 'coffee', color: '#a16207' },
    { g: '饮食', name: '饮食/外卖', icon: 'bag', color: '#ef4444' },
    /* —— 其他 —— */
    { g: '其他', name: '其他', icon: 'dots', color: '#94a3b8' },
    { g: '其他', name: '重要', icon: 'star', color: '#f59e0b' },
    { g: '其他', name: '灵感', icon: 'idea', color: '#eab308' },
    { g: '其他', name: '未打标签', icon: 'dots', color: '#cbd5e1' }
  ];

  var TAG_GROUPS = ['学习', '生活', '工作', '健康', '运动', '娱乐', '社交', '出行', '饮食', '其他'];



  /* ==========================================================
   * 成就系统：定义与检测
   * ========================================================== */
  var ACH_TIER = {
    bronze: { color: '#cd7f32', label: '初级' },
    silver: { color: '#9aa7b5', label: '中级' },
    gold:   { color: '#ffb300', label: '高级' }
  };

  /* 成就分三类：抽卡 / 集卡 / 种树
   * - 累计型：带 metric + threshold（tree / streakNo6 / streakNo5 / coll3）
   * - 事件型：带 check() 函数（一次十连的特定结果，判定依据 gacha.lastTen） */
  var ACH_DEF = [
    /* —— 抽卡 —— */
    { id: 'gacha_all3', group: '抽卡', name: '绝世非皇', desc: '一次十连抽出的干员全部为三星', icon: 'star', tier: 'silver', points: 100,
      check: function () { var t = ((global.Store && global.Store.state && global.Store.state.pomodoro && global.Store.state.pomodoro.gacha) ? global.Store.state.pomodoro.gacha.lastTen : null); return !!(t && t.all3); } },
    { id: 'gacha_max4', group: '抽卡', name: '紫气东来', desc: '一次十连中最高星级仅为四星（不出五/六星）', icon: 'sparkle', tier: 'silver', points: 10,
      check: function () { var t = ((global.Store && global.Store.state && global.Store.state.pomodoro && global.Store.state.pomodoro.gacha) ? global.Store.state.pomodoro.gacha.lastTen : null); return !!(t && t.max4); } },
    { id: 'gacha_2six', group: '抽卡', name: '双黄蛋', desc: '一次十连中恰好抽出两个六星', icon: 'sun', tier: 'gold', points: 10,
      check: function () { var t = ((global.Store && global.Store.state && global.Store.state.pomodoro && global.Store.state.pomodoro.gacha) ? global.Store.state.pomodoro.gacha.lastTen : null); return !!(t && t.twoSix); } },
    { id: 'gacha_4six', group: '抽卡', name: '绝世欧皇', desc: '一次十连中抽出三个及以上六星（≥3）', icon: 'crown', tier: 'gold', points: 100,
      check: function () { var t = ((global.Store && global.Store.state && global.Store.state.pomodoro && global.Store.state.pomodoro.gacha) ? global.Store.state.pomodoro.gacha.lastTen : null); return !!(t && t.fourSix); } },
    { id: 'gacha_no6_70', group: '抽卡', name: '七秩非皇', desc: '连续 70 抽未出六星', icon: 'clock', tier: 'gold', points: 100,
      metric: 'streakNo6', threshold: 70 },
    { id: 'gacha_no5_30', group: '抽卡', name: '卅非皇', desc: '连续 30 抽未出五星', icon: 'moon', tier: 'silver', points: 100,
      metric: 'streakNo5', threshold: 30 },
    /* —— 集卡 —— */
    { id: 'collFaction', group: '集卡', name: '集齐阵营', desc: '集齐任意一个阵营的全部干员（≥6 人）', icon: 'box', tier: 'gold', points: 200,
      metric: 'collFaction', threshold: 1 },
    /* —— 种树 —— */
    /* 种树：逐级解锁。先要「植下一棵树」解锁，后续「种更多棵树」的成就才会出现；
     * 渲染层看到 req 前置未完成会直接隐藏该成就（见 collection.js achPane）。 */
    { id: 'tree1', group: '种树', name: '植下一棵树', desc: '种下 1 棵树', icon: 'leaf', tier: 'bronze', points: 3,
      metric: 'tree', threshold: 1 },
    { id: 'tree3', group: '种树', name: '植树新手', desc: '种下 3 棵树', icon: 'leaf', tier: 'bronze', points: 6,
      metric: 'tree', threshold: 3, req: 'tree1' },
    { id: 'tree10', group: '种树', name: '绿意盎然', desc: '种下 10 棵树', icon: 'tree', tier: 'silver', points: 12,
      metric: 'tree', threshold: 10, req: 'tree3' },
    { id: 'tree50', group: '种树', name: '森之守护', desc: '种下 50 棵树', icon: 'tree', tier: 'silver', points: 24,
      metric: 'tree', threshold: 50, req: 'tree10' },
    { id: 'tree100', group: '种树', name: '林海苍苍', desc: '种下 100 棵树', icon: 'tree', tier: 'gold', points: 48,
      metric: 'tree', threshold: 100, req: 'tree50' },

    /* —— 目标 —— */
    { id: 'goal_first', group: '目标', name: '不再只是待办', desc: '创建第一个目标', icon: 'target', tier: 'bronze', points: 10,
      metric: 'goalTotal', threshold: 1 },
    { id: 'goal_active5', group: '目标', name: '五线并进', desc: '同时在办 5 个目标（达到上限）', icon: 'flag', tier: 'silver', points: 30,
      metric: 'goalActive', threshold: 5 },
    { id: 'goal_achieved', group: '目标', name: '说到做到', desc: '有目标推进到 100% 并归档留档', icon: 'check', tier: 'gold', points: 60,
      metric: 'goalAchieved', threshold: 1 },
    { id: 'goal_review', group: '目标', name: '月末回头看', desc: '用月末复盘把进度写进日记一次', icon: 'book', tier: 'silver', points: 20,
      metric: 'goalReview', threshold: 1 },
    { id: 'goal_archived', group: '目标', name: '厚积薄发', desc: '累计归档 5 个目标', icon: 'crown', tier: 'gold', points: 100,
      metric: 'goalAchieved', threshold: 5, req: 'goal_achieved' },

    /* —— 历练：各功能使用次数成就，分三档逐级解锁（1 / 10 / 100）——
     * 初出茅庐(1) → 小有心得(10, 需初出茅庐) → 炉火纯青(100, 需小有心得)
     * metric 用 'usage:<key>'，由 state.usage[<key>] 计次 */
    { id: 'use_course_1', group: '历练', name: '初出茅庐：课程表', desc: '首次使用课程表', icon: 'sparkle', tier: 'bronze', points: 10, metric: 'usage:course', threshold: 1 },
    { id: 'use_course_10', group: '历练', name: '小有心得：课程表', desc: '使用课程表 10 次', icon: 'star', tier: 'silver', points: 30, metric: 'usage:course', threshold: 10, req: 'use_course_1' },
    { id: 'use_course_100', group: '历练', name: '炉火纯青：课程表', desc: '使用课程表 100 次', icon: 'crown', tier: 'gold', points: 80, metric: 'usage:course', threshold: 100, req: 'use_course_10' },
    { id: 'use_plan_1', group: '历练', name: '初出茅庐：计划', desc: '首次执行计划（打卡 / 记录进度）', icon: 'sparkle', tier: 'bronze', points: 10, metric: 'usage:plan', threshold: 1 },
    { id: 'use_plan_10', group: '历练', name: '小有心得：计划', desc: '执行计划 10 次', icon: 'star', tier: 'silver', points: 30, metric: 'usage:plan', threshold: 10, req: 'use_plan_1' },
    { id: 'use_plan_100', group: '历练', name: '炉火纯青：计划', desc: '执行计划 100 次', icon: 'crown', tier: 'gold', points: 80, metric: 'usage:plan', threshold: 100, req: 'use_plan_10' },
    { id: 'use_ledger_1', group: '历练', name: '初出茅庐：记账', desc: '首次记账', icon: 'sparkle', tier: 'bronze', points: 10, metric: 'usage:ledger', threshold: 1 },
    { id: 'use_ledger_10', group: '历练', name: '小有心得：记账', desc: '记账 10 次', icon: 'star', tier: 'silver', points: 30, metric: 'usage:ledger', threshold: 10, req: 'use_ledger_1' },
    { id: 'use_ledger_100', group: '历练', name: '炉火纯青：记账', desc: '记账 100 次', icon: 'crown', tier: 'gold', points: 80, metric: 'usage:ledger', threshold: 100, req: 'use_ledger_10' },
    { id: 'use_grade_1', group: '历练', name: '初出茅庐：成绩', desc: '首次记录成绩', icon: 'sparkle', tier: 'bronze', points: 10, metric: 'usage:grade', threshold: 1 },
    { id: 'use_grade_10', group: '历练', name: '小有心得：成绩', desc: '记录成绩 10 次', icon: 'star', tier: 'silver', points: 30, metric: 'usage:grade', threshold: 10, req: 'use_grade_1' },
    { id: 'use_grade_100', group: '历练', name: '炉火纯青：成绩', desc: '记录成绩 100 次', icon: 'crown', tier: 'gold', points: 80, metric: 'usage:grade', threshold: 100, req: 'use_grade_10' },
    { id: 'use_meal_1', group: '历练', name: '初出茅庐：饮食', desc: '首次记录饮食', icon: 'sparkle', tier: 'bronze', points: 10, metric: 'usage:meal', threshold: 1 },
    { id: 'use_meal_10', group: '历练', name: '小有心得：饮食', desc: '记录饮食 10 次', icon: 'star', tier: 'silver', points: 30, metric: 'usage:meal', threshold: 10, req: 'use_meal_1' },
    { id: 'use_meal_100', group: '历练', name: '炉火纯青：饮食', desc: '记录饮食 100 次', icon: 'crown', tier: 'gold', points: 80, metric: 'usage:meal', threshold: 100, req: 'use_meal_10' },
    { id: 'use_sleep_1', group: '历练', name: '初出茅庐：睡眠', desc: '首次记录睡眠', icon: 'sparkle', tier: 'bronze', points: 10, metric: 'usage:sleep', threshold: 1 },
    { id: 'use_sleep_10', group: '历练', name: '小有心得：睡眠', desc: '记录睡眠 10 次', icon: 'star', tier: 'silver', points: 30, metric: 'usage:sleep', threshold: 10, req: 'use_sleep_1' },
    { id: 'use_sleep_100', group: '历练', name: '炉火纯青：睡眠', desc: '记录睡眠 100 次', icon: 'crown', tier: 'gold', points: 80, metric: 'usage:sleep', threshold: 100, req: 'use_sleep_10' },
    { id: 'use_focus_1', group: '历练', name: '初出茅庐：专注', desc: '首次完成一次专注', icon: 'sparkle', tier: 'bronze', points: 10, metric: 'usage:focus', threshold: 1 },
    { id: 'use_focus_10', group: '历练', name: '小有心得：专注', desc: '完成专注 10 次', icon: 'star', tier: 'silver', points: 30, metric: 'usage:focus', threshold: 10, req: 'use_focus_1' },
    { id: 'use_focus_100', group: '历练', name: '炉火纯青：专注', desc: '完成专注 100 次', icon: 'crown', tier: 'gold', points: 80, metric: 'usage:focus', threshold: 100, req: 'use_focus_10' },
    /* 专注里程：累计专注时长解锁，走成就发分 */
    { id: 'focus_h10', group: '专注', name: '专注里程 10 小时', desc: '累计专注满 10 小时', icon: 'clock', tier: 'bronze', points: 30, metric: 'focusMinutes', threshold: 600 },
    { id: 'focus_h30', group: '专注', name: '专注里程 30 小时', desc: '累计专注满 30 小时', icon: 'clock', tier: 'silver', points: 60, metric: 'focusMinutes', threshold: 1800, req: 'focus_h10' },
    { id: 'focus_h60', group: '专注', name: '专注里程 60 小时', desc: '累计专注满 60 小时', icon: 'star', tier: 'silver', points: 120, metric: 'focusMinutes', threshold: 3600, req: 'focus_h30' },
    { id: 'focus_h100', group: '专注', name: '专注里程 100 小时', desc: '累计专注满 100 小时', icon: 'crown', tier: 'gold', points: 200, metric: 'focusMinutes', threshold: 6000, req: 'focus_h60' },
    { id: 'focus_h200', group: '专注', name: '专注里程 200 小时', desc: '累计专注满 200 小时', icon: 'crown', tier: 'gold', points: 400, metric: 'focusMinutes', threshold: 12000, req: 'focus_h100' },
    { id: 'use_note_1', group: '历练', name: '初出茅庐：速记', desc: '首次使用速记', icon: 'sparkle', tier: 'bronze', points: 10, metric: 'usage:note', threshold: 1 },
    { id: 'use_note_10', group: '历练', name: '小有心得：速记', desc: '使用速记 10 次', icon: 'star', tier: 'silver', points: 30, metric: 'usage:note', threshold: 10, req: 'use_note_1' },
    { id: 'use_note_100', group: '历练', name: '炉火纯青：速记', desc: '使用速记 100 次', icon: 'crown', tier: 'gold', points: 80, metric: 'usage:note', threshold: 100, req: 'use_note_10' },
    { id: 'use_event_1', group: '历练', name: '初出茅庐：日程', desc: '首次添加日程', icon: 'sparkle', tier: 'bronze', points: 10, metric: 'usage:event', threshold: 1 },
    { id: 'use_event_10', group: '历练', name: '小有心得：日程', desc: '添加日程 10 次', icon: 'star', tier: 'silver', points: 30, metric: 'usage:event', threshold: 10, req: 'use_event_1' },
    { id: 'use_event_100', group: '历练', name: '炉火纯青：日程', desc: '添加日程 100 次', icon: 'crown', tier: 'gold', points: 80, metric: 'usage:event', threshold: 100, req: 'use_event_10' }
  ];

  /** 成就分类顺序：抽卡 / 集卡 / 种树 */
  var ACH_GROUPS = ['抽卡', '集卡', '种树', '目标', '专注', '历练'];

  /** 当前各成就指标的实际数值 */

  /**
   * 等级制（五级制）成绩的默认换算：分数只用于算加权均分，绩点单独给。
   * 很多学校有「优/良/中/及格/不及格」和「通过/不通过」两类课程。
   */
  var GPA_LEVEL_RULES = [
    { key: 'A', name: '优', score: 95, gp: 4.0 },
    { key: 'B', name: '良', score: 85, gp: 3.5 },
    { key: 'C', name: '中', score: 75, gp: 2.5 },
    { key: 'D', name: '及格', score: 65, gp: 1.5 },
    { key: 'F', name: '不及格', score: 50, gp: 0 }
  ];

  var StorePresets = {
    POMO: POMO,
    TREE_SPECIES: TREE_SPECIES,
    TREE_STAGES: TREE_STAGES,
    TAG_PRESETS: TAG_PRESETS,
    TAG_GROUPS: TAG_GROUPS,
    ACH_TIER: ACH_TIER,
    ACH_DEF: ACH_DEF,
    ACH_GROUPS: ACH_GROUPS,
    GPA_LEVEL_RULES: GPA_LEVEL_RULES
  };

  global.StorePresets = StorePresets;
  if (global.CP && global.CP.register) global.CP.register('StorePresets', StorePresets);
})(typeof window !== 'undefined' ? window : globalThis);
