/* ==========================================================
 * 每日一句（古诗/古文） + 每日一词（专四词汇）——首屏迷你集
 *
 * 为什么要有这个文件：完整语料 quotes-data.js 有 800KB，占单文件三分之一，
 * 而它并不是首屏必需的。现在 index.html 只内联这份迷你集（约 15KB），
 * 完整语料作为同目录的 quotes-data.js 按需加载，加载完自动升级。
 *
 * 两个必须守住的约束：
 *  1) 诗必须取「原顺序的前 24 篇」。settings.daily.poem 存的是下标，
 *     收藏也按下标记；顺序一变，老用户的收藏就会指到别的诗上。
 *  2) 词是按顺序均匀抽的 60 个（不是前 60 个，否则「换一个」永远在 a 开头）。
 *     词的收藏按单词字符串存，所以抽哪些不影响收藏。
 * ========================================================== */
(function (global) {
  'use strict';

  var POEMS = [
{t:"关雎",a:"《诗经》",d:"先秦",ex:"关关雎鸠，在河之洲。窈窕淑女，君子好逑。",body:["关关雎鸠，在河之洲。窈窕淑女，君子好逑。", "参差荇菜，左右流之。窈窕淑女，寤寐求之。"],note:"《诗经》开篇之作。以水鸟和鸣起兴，写君子对淑女的思慕，被孔子评为「乐而不淫，哀而不伤」。"},
{t:"蒹葭",a:"《诗经》",d:"先秦",ex:"蒹葭苍苍，白露为霜。所谓伊人，在水一方。",body:["蒹葭苍苍，白露为霜。所谓伊人，在水一方。", "溯洄从之，道阻且长。溯游从之，宛在水中央。"],note:"秋水伊人，可望而不可即。重章叠句营造出朦胧缥缈的意境，「在水一方」成为追寻理想的代称。"},
{t:"观沧海",a:"曹操",d:"东汉",ex:"日月之行，若出其中；星汉灿烂，若出其里。",body:["东临碣石，以观沧海。水何澹澹，山岛竦峙。", "树木丛生，百草丰茂。秋风萧瑟，洪波涌起。", "日月之行，若出其中；星汉灿烂，若出其里。"],note:"曹操北征乌桓途中所作。借大海吞吐日月的气象写胸襟，是中国诗史上较早的山水名篇。"},
{t:"饮酒·其五",a:"陶渊明",d:"东晋",ex:"采菊东篱下，悠然见南山。",body:["结庐在人境，而无车马喧。问君何能尔？心远地自偏。", "采菊东篱下，悠然见南山。山气日夕佳，飞鸟相与还。", "此中有真意，欲辨已忘言。"],note:"陶渊明归隐后的代表作。「心远地自偏」道出心境决定处境的道理，「悠然」二字尽得自然之趣。"},
{t:"送杜少府之任蜀州",a:"王勃",d:"唐",ex:"海内存知己，天涯若比邻。",body:["城阙辅三秦，风烟望五津。与君离别意，同是宦游人。", "海内存知己，天涯若比邻。无为在歧路，儿女共沾巾。"],note:"初唐送别诗名篇。一改别离诗的凄婉缠绵，以旷达语慰藉远行人，气象开阔。"},
{t:"登幽州台歌",a:"陈子昂",d:"唐",ex:"念天地之悠悠，独怆然而涕下。",body:["前不见古人，后不见来者。", "念天地之悠悠，独怆然而涕下。"],note:"陈子昂怀才不遇，登台而歌。时空之无限与个体之孤独形成强烈反差，被视为盛唐气象的先声。"},
{t:"回乡偶书",a:"贺知章",d:"唐",ex:"少小离家老大回，乡音无改鬓毛衰。",body:["少小离家老大回，乡音无改鬓毛衰。", "儿童相见不相识，笑问客从何处来。"],note:"久客返乡的感慨。以儿童的「笑问」反衬老者的沧桑，平淡中见深沉。"},
{t:"春江花月夜",a:"张若虚",d:"唐",ex:"春江潮水连海平，海上明月共潮生。",body:["春江潮水连海平，海上明月共潮生。", "滟滟随波千万里，何处春江无月明。", "江畔何人初见月？江月何年初照人？"],note:"被誉为「孤篇盖全唐」。以月为线，交织江、花、夜，追问人生与宇宙的永恒。"},
{t:"登鹳雀楼",a:"王之涣",d:"唐",ex:"欲穷千里目，更上一层楼。",body:["白日依山尽，黄河入海流。", "欲穷千里目，更上一层楼。"],note:"二十字写尽登临之意。前两句写景气象阔大，后两句说理，激励人不断向上。"},
{t:"春晓",a:"孟浩然",d:"唐",ex:"春眠不觉晓，处处闻啼鸟。",body:["春眠不觉晓，处处闻啼鸟。", "夜来风雨声，花落知多少。"],note:"以听觉写春晨。由喜春转为惜春，一问「花落知多少」，余味悠长。"},
{t:"出塞",a:"王昌龄",d:"唐",ex:"秦时明月汉时关，万里长征人未还。",body:["秦时明月汉时关，万里长征人未还。", "但使龙城飞将在，不教胡马度阴山。"],note:"唐代边塞诗压卷之作。跨越秦汉与当下，写征人之苦与对良将的企盼。"},
{t:"九月九日忆山东兄弟",a:"王维",d:"唐",ex:"独在异乡为异客，每逢佳节倍思亲。",body:["独在异乡为异客，每逢佳节倍思亲。", "遥知兄弟登高处，遍插茱萸少一人。"],note:"重阳思亲的名句。从自己推想兄弟登高时少了「我」一人，用笔曲折而情意真切。"},
{t:"山居秋暝",a:"王维",d:"唐",ex:"明月松间照，清泉石上流。",body:["空山新雨后，天气晚来秋。明月松间照，清泉石上流。", "竹喧归浣女，莲动下渔舟。随意春芳歇，王孙自可留。"],note:"王维山水诗的代表。以动衬静，清泉明月间见出空灵之境，苏轼评其「诗中有画」。"},
{t:"静夜思",a:"李白",d:"唐",ex:"床前明月光，疑是地上霜。",body:["床前明月光，疑是地上霜。", "举头望明月，低头思故乡。"],note:"最家喻户晓的唐诗。由误认月光为霜，到望月思乡，二十字道尽游子心事。"},
{t:"望庐山瀑布",a:"李白",d:"唐",ex:"飞流直下三千尺，疑是银河落九天。",body:["日照香炉生紫烟，遥看瀑布挂前川。", "飞流直下三千尺，疑是银河落九天。"],note:"李白浪漫主义笔法的典型。以银河喻瀑布，夸张而不失气势。"},
{t:"将进酒",a:"李白",d:"唐",ex:"君不见黄河之水天上来，奔流到海不复回。",body:["君不见黄河之水天上来，奔流到海不复回。", "君不见高堂明镜悲白发，朝如青丝暮成雪。", "人生得意须尽欢，莫使金樽空对月。", "天生我材必有用，千金散尽还复来。"],note:"李白饮酒诗的代表。开篇两组排比如天风海雨，既有狂放也有自信。"},
{t:"行路难",a:"李白",d:"唐",ex:"长风破浪会有时，直挂云帆济沧海。",body:["金樽清酒斗十千，玉盘珍羞直万钱。停杯投箸不能食，拔剑四顾心茫然。", "欲渡黄河冰塞川，将登太行雪满山。", "长风破浪会有时，直挂云帆济沧海。"],note:"写仕途困顿中的愤懑与自信。末句以破浪济海自许，成为千古励志名句。"},
{t:"望岳",a:"杜甫",d:"唐",ex:"会当凌绝顶，一览众山小。",body:["岱宗夫如何？齐鲁青未了。造化钟神秀，阴阳割昏晓。", "荡胸生曾云，决眦入归鸟。会当凌绝顶，一览众山小。"],note:"杜甫青年时所作。借泰山写抱负，末句尽显盛唐气象与少年心气。"},
{t:"春夜喜雨",a:"杜甫",d:"唐",ex:"随风潜入夜，润物细无声。",body:["好雨知时节，当春乃发生。", "随风潜入夜，润物细无声。", "野径云俱黑，江船火独明。晓看红湿处，花重锦官城。"],note:"杜甫居成都草堂时所作。以「知」「潜」「润」写春雨之善解人意，体贴入微。"},
{t:"登高",a:"杜甫",d:"唐",ex:"无边落木萧萧下，不尽长江滚滚来。",body:["风急天高猿啸哀，渚清沙白鸟飞回。", "无边落木萧萧下，不尽长江滚滚来。", "万里悲秋常作客，百年多病独登台。"],note:"被誉为「古今七律第一」。八句皆对，身世之感与秋景交融，风格沉郁顿挫。"},
{t:"白雪歌送武判官归京",a:"岑参",d:"唐",ex:"忽如一夜春风来，千树万树梨花开。",body:["北风卷地白草折，胡天八月即飞雪。", "忽如一夜春风来，千树万树梨花开。", "山回路转不见君，雪上空留马行处。"],note:"边塞奇景与送别之情交织。以梨花喻雪，成为咏雪的千古奇句。"},
{t:"枫桥夜泊",a:"张继",d:"唐",ex:"月落乌啼霜满天，江枫渔火对愁眠。",body:["月落乌啼霜满天，江枫渔火对愁眠。", "姑苏城外寒山寺，夜半钟声到客船。"],note:"羁旅诗的绝唱。声色交织，寒山寺的夜半钟声把愁绪推到极远处。"},
{t:"陋室铭",a:"刘禹锡",d:"唐",ex:"山不在高，有仙则名。水不在深，有龙则灵。",body:["山不在高，有仙则名。水不在深，有龙则灵。", "斯是陋室，惟吾德馨。", "苔痕上阶绿，草色入帘青。谈笑有鸿儒，往来无白丁。"],note:"刘禹锡被贬时所作。以陋室自况，表达安贫乐道、不慕荣利的情操。"},
{t:"赋得古原草送别",a:"白居易",d:"唐",ex:"野火烧不尽，春风吹又生。",body:["离离原上草，一岁一枯荣。", "野火烧不尽，春风吹又生。", "远芳侵古道，晴翠接荒城。又送王孙去，萋萋满别情。"],note:"白居易十六岁应考习作。以野草喻顽强生命力，也暗含别情绵绵不尽。"},
  ];

  var WORDS = [
{w:"abandon",ph:"/əˈbændən/",pos:"v.",def:"放弃；抛弃；遗弃",ex:"The crew had to abandon the sinking ship.",exCn:"船员们不得不弃船逃生。",tip:"a-(离开) + bandon(控制) → 脱离控制 → 放弃",star:0},
{w:"agony",ph:"/ˈægəni/",pos:"n.",def:"极大的痛苦,苦恼，烦闷,临死的挣扎,（感情的）迸发",star:3},
{w:"apostle",ph:"/əˈpɒsl/",pos:"n.",def:"(A-)（基督教的）使徒,早期基督教的传教士,摩门教教会的十二个行政执事之一,（改革运动的）倡导者",star:2},
{w:"audacity",ph:"/ɔ:ˈdæsəti/",pos:"n.",def:"大胆,鲁莽,胆大妄为,鲁莽行为",star:2},
{w:"batter",ph:"/ˈbætə(r)/",pos:"vt.& vi.",def:"连续猛击,捣碎，打烂,磨损,使内倾，使倾斜\n",star:2},
{w:"bloodshed",ph:"/ˈblʌdʃed/",pos:"n.",def:"流血,屠杀，杀戮,流血事件",star:2},
{w:"bribe",ph:"/braɪb/",pos:"vt.& vi.",def:"贿赂，行贿\n",star:2},
{w:"calmly",ph:"/'kɑ:mlɪ/",pos:"adv.",def:"平静地,宁静地,冷静地,沉着地",star:2},
{w:"chant",ph:"/tʃɑ:nt/",pos:"vt.",def:"吟颂，咏唱,反复有节奏地喊叫（或唱等）\n",star:3},
{w:"claudia",pos:"n.",def:"克劳迪娅(f.)",star:2},
{w:"competent",ph:"/ˈkɒmpɪtənt/",pos:"adj.",def:"有能力的，能胜任的,能干的，称职的,足够的，充足的,有决定权的",star:4},
{w:"contagious",ph:"/kənˈteɪdʒəs/",pos:"adj.",def:"有传染性的,传染病的,有感染力的,会蔓延的",star:2},
{w:"cowardice",ph:"/ˈkaʊədɪs/",pos:"n.",def:"懦弱，胆怯",star:1},
{w:"cutter",ph:"/ˈkʌtə(r)/",pos:"n.",def:"切削者，切割机,独桅纵帆船,小艇，小型武装快艇,轻便雪橇",star:3},
{w:"depart",ph:"/dɪˈpɑ:t/",pos:"v.",def:"离开，出发,去世,离职,脱轨",star:3},
{w:"discharge",ph:"/dɪsˈtʃɑ:dʒ/",pos:"vt.",def:"下（客）,卸船,免除（自己的义务、负担等）,执行\n",star:4},
{w:"doorstep",ph:"/ˈdɔ:step/",pos:"n.",def:"门阶,厚三明治或面包\n",star:2},
{w:"elderly",ph:"/ˈeldəli/",pos:"adj.",def:"上了年纪的,过了中年的,较老的\n",star:5},
{w:"ethics",ph:"/'eθɪks/",pos:"n.",def:"道德准则,伦理标准",star:5},
{w:"fare",ph:"/feə(r)/",pos:"n.",def:"费,票价,乘客,食物\n",star:4},
{w:"flaw",ph:"/flɔ:/",pos:"n.",def:"瑕疵，缺点,一阵狂风,短暂的风暴,裂缝，裂纹\n",star:3},
{w:"frighten",ph:"/ˈfraɪtn/",pos:"vt.",def:"使惊恐，使恐慌,吓走，赶走\n",star:1},
{w:"geometry",ph:"/dʒiˈɒmətri/",pos:"n.",def:"几何学,几何形状,几何图形,几何学著作",star:3},
{w:"greenhouse",ph:"/ˈgri:nhaʊs/",pos:"n.",def:"温室，花房,[军]<俚>周围有玻璃的座舱，轰炸员舱",star:3},
{w:"haste",ph:"/heɪst/",pos:"n.",def:"匆忙，急忙,急速，紧迫,轻率\n",star:2},
{w:"hitter",ph:"/ˈhɪtə(r)/",pos:"n.",def:"打者，击手，（棒球）击球员,[机]铆钉枪",star:2},
{w:"hypocrisy",ph:"/hɪˈpɒkrəsi/",pos:"n.",def:"伪善，虚伪",star:3},
{w:"indistinct",ph:"/ˌɪndɪˈstɪŋkt/",pos:"adj.",def:"不清楚的，模糊的\n",star:1},
{w:"intercept",ph:"/ˌɪntəˈsept/",pos:"vt.",def:"拦截，拦住,截球,截击,拦阻\n",star:2},
{w:"jester",ph:"/ˈdʒestə(r)/",pos:"n.",def:"（昔日为统治者说笑逗乐的）弄臣",star:1},
{w:"lax",ph:"/læks/",pos:"adj.",def:"<医>（肠）宽松的,松弛的,松懈的,不严格的\n",star:2},
{w:"lookout",ph:"/ˈlʊkaʊt/",pos:"n.",def:"守望,远景，前途,瞭望台,警戒",star:3},
{w:"manor",ph:"/ˈmænə(r)/",pos:"n.",def:"庄园,领地,庄园大厦,庄园主的住宅",star:3},
{w:"memo",ph:"/ˈmeməʊ/",pos:"n.",def:"备忘录,（美）内部通知",star:3},
{w:"momentum",ph:"/məˈmentəm/",pos:"n.",def:"[物]动量,势头,动力,要素，契机",star:4},
{w:"navigator",ph:"/ˈnævɪgeɪtə(r)/",pos:"n.",def:"航海家，航行者，航海者,领航员,（船舶，飞机的）驾驶员,一个浏览器的品牌",star:2},
{w:"obscene",ph:"/əbˈsi:n/",pos:"adj.",def:"淫秽的,下流的,猥亵的,可憎的",star:2},
{w:"outline",ph:"/ˈaʊtlaɪn/",pos:"n.",def:"梗概，大纲，提纲，草稿，要点，主要原则,外形，轮廓，轮廓线，轮廓画法，略图（画法）\n",star:4},
{w:"patiently",ph:"/'peɪʃntlɪ/",pos:"adv.",def:"耐心地，坚韧不拔地",star:2},
{w:"picket",ph:"/ˈpɪkɪt/",pos:"n.",def:"罢工纠察员,警戒队,[建]尖木桩,[军]步哨，哨兵\n",star:2},
{w:"poodle",ph:"/ˈpu:dl/",pos:"n.",def:"髦毛小狗,贵宾犬",star:1},
{w:"probe",ph:"/prəʊb/",pos:"n.",def:"[医]（对伤处等的）针探，探查,[医]探针，取样器,探头,探测仪\n",star:4},
{w:"purge",ph:"/pɜ:dʒ/",pos:"vt.",def:"清除，（使）净化,（使）通便,肃清\n",star:2},
{w:"realtor",ph:"/'ri:əltə(r)/",pos:"n.",def:"<美>房地产经纪人，（尤指）美国房地产同业公会成员",star:2},
{w:"remainder",ph:"/rɪˈmeɪndə(r)/",pos:"n.",def:"剩余物,其他人员,差数,廉价出售的图书\n",star:4},
{w:"ribbon",ph:"/ˈrɪbən/",pos:"n.",def:"带,（打印机的）色带,绶带,带状物\n",star:3},
{w:"sailboat",ph:"/ˈseɪlbəʊt/",pos:"n.",def:"<美>帆船(= sailing boat)",star:1},
{w:"seduce",ph:"/sɪˈdju:s/",pos:"vt.",def:"勾引，引诱,诱奸（妇女）,诱使…堕落,迷惑，使入迷",star:2},
{w:"shortcut",ph:"/'ʃɔ:tkʌt/",pos:"n.",def:"捷径，近路,被切短的东西",star:2},
{w:"slime",ph:"/slaɪm/",pos:"n.",def:"黏质物,黏液,黏泥,软泥\n",star:2},
{w:"span",ph:"/spæn/",pos:"n.",def:"共轭（马、骡）,跨度，墩距,一段时间,[航] 跨绳\n",star:4},
{w:"stead",ph:"/sted/",pos:"n.",def:"代替,用处，好处,有帮助\n",star:1},
{w:"suffice",ph:"/səˈfaɪs/",pos:"vi.",def:"足够,有能力\n",star:2},
{w:"tacky",ph:"/ˈtæki/",pos:"adj.",def:"发黏的,俗气的,褴褛的,缺乏教养或风度的",star:1},
{w:"thinner",ph:"/ˈθɪnə(r)/",pos:"n.",def:"（油漆的）稀释剂,使变稀薄者，加稀料的制漆工\n",star:2},
{w:"tramp",ph:"/træmp/",pos:"vi.",def:"步行,踩,踏,漂泊\n",star:2},
{w:"twister",ph:"/ˈtwɪstə(r)/",pos:"n.",def:"难题,旋风,旋转的人,<体>旋转球",star:1},
{w:"unreal",ph:"/ˌʌnˈrɪəl/",pos:"adj.",def:"不真实的，假的,幻想的，虚构的,非现实的,虚幻",star:2},
{w:"vial",ph:"/ˈvaɪəl/",pos:"n.",def:"小瓶,小玻璃瓶,药水瓶,郁积的情绪（如愤怒等）",star:1},
{w:"weave",ph:"/wi:v/",pos:"vt.& vi.",def:"编，织,迂回行进,穿行（以避开障碍）\n",star:2},
  ];

  function hash(str) {
    var h = 0, i;
    for (i = 0; i < str.length; i++) {
      h = (h * 31 + str.charCodeAt(i)) % 2147483647;
    }
    return Math.abs(h);
  }

  /** 随机取一个与 cur 不同的下标 */
  function randExcept(n, cur) {
    if (n <= 1) return 0;
    var v = Math.floor(Math.random() * n);
    if (v === cur) v = (v + 1 + Math.floor(Math.random() * (n - 1))) % n;
    return v;
  }

  var Daily = {
    poems: POEMS,
    words: WORDS,
    full: false,       // 完整语料是否已接上

    /**
     * 初始化并推进索引：首次按当天日期取一个稳定起点；
     * 之后每天第一次打开自动前进一条，手动切换后当天不再跳。
     */
    ensure: function () {
      var s = Store.state.settings;
      var today = DateUtil.toStr(DateUtil.today());
      var np = this.poems.length, nw = this.words.length;
      if (!s.daily || s.daily.poem == null) {
        s.daily = {
          date: today,
          pushed: today,
          poem: hash(today + 'p') % np,
          word: hash(today + 'w') % nw
        };
        Store.save();
        return s.daily;
      }
      if (s.daily.pushed !== today) {
        s.daily.poem = (s.daily.poem + 1) % np;
        s.daily.word = (s.daily.word + 1) % nw;
        s.daily.pushed = today;
        Store.save();
      }
      return s.daily;
    },

    poem: function () {
      var d = this.ensure();
      if (!this.poems.length) return { t: '', a: '', ex: '', body: [] };
      return this.poems[d.poem % this.poems.length];
    },

    word: function () {
      var d = this.ensure();
      if (!this.words.length) return { w: '', def: '' };
      return this.words[d.word % this.words.length];
    },

    /** 随机换一条（不重复当前这条） */
    nextPoem: function () {
      var d = this.ensure();
      d.poem = randExcept(this.poems.length, d.poem);
      Store.updateSettings({ daily: d });
      return this.poem();
    },

    nextWord: function () {
      var d = this.ensure();
      d.word = randExcept(this.words.length, d.word);
      Store.updateSettings({ daily: d });
      return this.word();
    },

    count: function () {
      return { poems: this.poems.length, words: this.words.length };
    }
  };

  global.Daily = Daily;

  /* ---------------- 完整语料：接上后原地升级 ---------------- */
  global.__cpDailyUpgrade = function (full) {
    if (!full || !Array.isArray(full.poems) || !Array.isArray(full.words)) return;
    if (!full.poems.length || !full.words.length) return;
    Daily.poems = full.poems;
    Daily.words = full.words;
    Daily.full = true;
    // 卡片上的「随机取自 N 篇」、设置页里的条数都要跟着变
    if (global.Store && global.Store.emit) global.Store.emit();
  };

  var loading = null;

  /** 按需加载完整语料。失败就算了——迷你集照样能用，不弹错误打断用户 */
  function loadFull() {
    if (Daily.full) return Promise.resolve(Daily);
    if (loading) return loading;
    loading = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = new URL('quotes-data.js', location.href).href;
      s.async = true;
      s.onload = function () {
        if (!Daily.full && global.__cpDailyFull) global.__cpDailyUpgrade(global.__cpDailyFull);
        resolve(Daily);
      };
      s.onerror = function () { loading = null; resolve(Daily); };
      document.head.appendChild(s);
    });
    return loading;
  }

  global.__cpDailyLoad = loadFull;
  // 旧名字：只求「同步拿到 Daily」，加载在后台进行，不阻塞调用方
  global.__cpLoadDaily = function () { loadFull(); return Daily; };
})(window);
