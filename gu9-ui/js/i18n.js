/* ============================================================
   GU9 i18n —— 简体中文 / 繁體中文 / English / 日本語 / 한국어 五语运行时翻译层
   ------------------------------------------------------------
   设计说明（2026-10-03）：
   · 业务代码里散落着 1200+ 条硬编码中文，逐个抽 key 重构成本极高
     且极易改坏已上线的牌桌逻辑。这里改用「运行时 DOM 翻译层」：
     保留原文（WeakMap），渲染完成后统一翻译文本节点与
     placeholder / title / alt / value，MutationObserver 兜住后续
     所有动态插入的内容。改语言时从原文重新翻译，不会漂移。
   · 英文走「整句字典 → 最长匹配切分拼接」，繁体走「词条字典 →
     逐字映射」，两者都自带兜底，未收录的文案会保持原样而不是乱码。
   · 未登录也要能切换（美国玩家一进来就得看到 English），
     所以语言选择存 localStorage，登录后同步到服务端账号。
   ============================================================ */
(function (global) {
  'use strict';

  var LANGS = [
    { k: 'zh-CN', n: '简体中文', s: '简', flag: '🇨🇳' },
    { k: 'zh-TW', n: '繁體中文', s: '繁', flag: '🇹🇼' },
    { k: 'en', n: 'English', s: 'EN', flag: '🇺🇸' },
    { k: 'ja', n: '日本語', s: '日', flag: '🇯🇵' },
    { k: 'ko', n: '한국어', s: '한', flag: '🇰🇷' }
  ];
  var EN = {"筹码":"Chips","好友":"Friends","完成":"Done","弃牌":"Fold","过牌":"Check","跟注":"Call","Allin小王子":"All-in Prince","下注":"Bet","河牌杀手":"River Killer","退出":"Exit","加注":"Raise","创建并进入":"Create & Enter","拒绝":"Decline","规则说明":"Rules","兑换成 USDT":"Convert to USDT","我的订单":"My Orders","操作失败，请重试":"Action failed, please try again","私聊":"Private Message","买入 / 加码":"Buy-in / Add Chips","离开牌桌":"Leave Table","底牌刺客":"Hole Card Assassin","皇家同花顺":"Royal Flush","等":"waiting","高牌":"High Card","前注":"Ante","翻牌前":"Pre-flop","翻牌":"Flop","转牌":"Turn","河牌":"River","快速开始":"Quick Start","无法进入这个房间":"Cannot enter this room","入池率":"VPIP","加入房间":"Join Room","全部":"All","保险":"Insurance","德州扑克":"Texas Hold'em","加载中…":"Loading…","请输入账号":"Please enter your account","密码至少 6 位":"Password must be at least 6 characters","转账":"Transfer","抽水规则":"Rake Rules","邀请好友":"Invite Friends","道具":"Items","服务费":"Service Fee","邀请好友入座":"Invite Friends to Seat","手牌回顾":"Hand Review","已开启":"Enabled","玩家":"Player","牌桌浪人":"Table Drifter","德州老炮":"Hold'em Veteran","偷盲狂魔":"Blind Stealer","中国":"China","已完成":"Completed","系统":"System","短牌 6+":"Short Deck 6+","极速":"Rush","SNG 单桌赛":"SNG Sit & Go","MTT 锦标赛":"MTT Tournament","一对":"One Pair","两对":"Two Pair","三条":"Three of a Kind","顺子":"Straight","同花":"Flush","葫芦":"Full House","四条":"Four of a Kind","同花顺":"Straight Flush","强抓":"Straddle","弃底牌":"Discard Hole Card","边池":"Side Pot","我的":"My","人":"players","已拒绝邀请":"Invitation declined","接受失败":"Failed to accept","已接受邀请，进入房间":"Invitation accepted, entering room","密码错误":"Wrong password","无法进入房间":"Cannot enter room","建房邀请":"Room Invitation","私人房":"Private Room","老大的私人牌局":"Boss's Private Game","创建中…":"Creating…","创建房间失败，请检查网络":"Failed to create room, please check your connection","接受":"Accept","盲注级别":"Blind Level","开启保险":"Enable Insurance","All-in 时可购买 EV 保险":"EV Insurance can be purchased when All-in","允许旁观":"Allow Spectators","房间号":"Room No.","密码":"Password","进入":"Enter","其它":"Other","登 录":"LOG IN","游客":"Guest","注册并登录":"Register & Log In","② 注册时填写的手机号（含区号）":"② Phone number used at registration (with country code)","③ 大概的注册时间":"③ Approximate registration time","昵称":"Nickname","邮件":"Mail","任务":"Tasks","数据统计":"Statistics","玩法大全":"All Game Variants","账号安全":"Account Security","设置":"Settings","客服中心":"Support Center","领取中…":"Claiming…","领取失败":"Claim failed","签到失败":"Check-in failed","签到成功，第":"Check-in successful, day","天":"days","复制失败，请长按手动复制":"Copy failed, please long-press to copy manually","（免费）进「USDT 余额」，再提现：单笔固定手续费 2 USDT，":"(free) into \"USDT Balance\", then withdraw: flat fee 2 USDT per transaction,","不限额度":"No limit","，走":", via","风控审核":"Risk Review","已领取":"Claimed","领取":"Claim","纯娱乐产品":"Pure entertainment product","充值本金与后台发放":"Deposit principal and admin grants","修改失败":"Update failed","实名认证":"ID Verification","背景音乐":"Background Music","震动反馈":"Haptic Feedback","四色扑克牌":"Four-Color Deck","自动盖牌":"Auto Muck","清除缓存":"Clear Cache","德州扑克规则":"Texas Hold'em Rules","游戏目标":"Objective","：用 2 张底牌与 5 张公共牌组成最大的 5 张牌型，赢取底池。":": Use your 2 hole cards and 5 community cards to make the best 5-card hand and win the pot.","牌型大小":"Hand Rankings","下注轮":"Betting Rounds","操作":"Actions","：All-in 时可按实时胜率购买 EV 保险，未赢下底池则获赔付。":": When All-in you may buy EV Insurance based on live equity; if you don't win the pot you get paid out.","更换头像":"Change Avatar","保存失败":"Save failed","头像已更新":"Avatar updated","个性签名":"Signature","充值":"Deposit","提现":"Withdraw","转账记录":"Transfer History","常见问题":"FAQ","报名费 10%":"Entry Fee 10%","无需密码":"No password required","房间号已复制：":"Room No. copied:","房间号：":"Room No.:","还没有好友":"No friends yet","复制房间号":"Copy Room No.","聊天":"Chat","表情":"Emoji","写点什么…":"Say something…","余额不足":"Insufficient balance","牌桌":"Table","已拒绝":"Declined","申请已发送":"Request sent","ID 已复制":"ID copied","已发送":"Sent","手牌数":"Hands Played","拉黑":"Block","牌桌聊天":"Table Chat","等待列表":"Waiting List","记分牌":"Scoreboard","胜率 / 赔率":"Equity / Pot Odds","音效":"Sound","已关闭":"Disabled","牌桌设置":"Table Settings","举报":"Report","什么是 EV 保险？":"What is EV Insurance?","如何计算？":"How is it calculated?","赔付规则":"Payout Rules","若你未赢下底池，获得最高赔付；若你赢下底池，仅扣除保费。":"If you don't win the pot you receive the maximum payout; if you win, only the premium is deducted.","踢出":"Kick","修改房间密码":"Change Room Password","转让房主":"Transfer Ownership","解散房间":"Dissolve Room","离开":"Leave","等待发牌":"Waiting for the deal","牌桌筹码":"Table Chips","从好友列表选择":"Choose from your friends","确认转账":"Confirm Transfer","下单失败":"Order failed","确认充值":"Confirm Deposit","已提交，等待后台审核":"Submitted, awaiting admin review","提交中…":"Submitting…","提交失败":"Submit failed","提交提现申请":"Submit Withdrawal Request","兑换免费":"Conversion is free","（牌桌盈利不能兑换）":"(Table winnings cannot be converted)","手续费":"Fee","实际到账":"Amount Received","查看我的订单":"View My Orders","链上网络":"Network","GU9 · 德州扑克":"GU9 · Texas Hold'em","这把运气太差了":"Bad luck this hand","有没有大佬带带我":"Anyone want to coach me?","50/100 缺人，来 3 个":"50/100 needs 3 more players","刚才那手打得漂亮":"Nice play on that last hand","广场赛开奖了，去看看":"Arena results are out, go check","求推荐紧凶打法":"Any tips for a tight-aggressive style?","连赢五把，收工":"Five wins in a row, calling it a night","有人一起打短牌吗":"Anyone up for Short Deck?","这保险买得值":"That insurance was worth it","新赛季冲榜！":"New season, let's climb!","12,000 筹码":"12,000 chips","12,000 筹码 ≈ 20 USDT":"12,000 chips ≈ 20 USDT","筹码 ≈":"chips ≈","亿":"00M","万":"0K","秒前":"seconds ago","分钟前":"minutes ago","小时前":"hours ago","天前":"days ago","葫芦娃":"Full House Fan","慢打大师":"Slowplay Master","翻牌之神":"Flop God","坚果猎人":"Nut Hunter","澳门赌神":"Macau Gambler","拉斯维加斯":"Las Vegas","冷静的AK":"Ice-Cold AK","同花顺制造机":"Straight Flush Machine","鱼塘霸主":"Fish Pond Boss","诈唬艺术家":"Bluff Artist","位置大师":"Position Master","筹码收割机":"Chip Harvester","紧凶玩家":"Tight-Aggressive","深夜牌神":"Midnight Poker God","三bet狂人":"3-Bet Maniac","跟注站":"Calling Station","石头玩家":"Rock","运气选手":"Lucky Player","扑克教授":"Poker Professor","概率信徒":"Probability Believer","读牌高手":"Hand Reader","小盲终结者":"Small Blind Terminator","河牌奇迹":"River Miracle","中国香港":"Hong Kong, China","中国澳门":"Macao, China","新加坡":"Singapore","马来西亚":"Malaysia","· 德州扑克":"· Texas Hold'em","网络不可用":"Network unavailable","赛事门票":"Tournament Ticket","订单发货":"Order Delivery","邀请你进房间":"invited you to room","（共":"(","条新消息）":"new messages)","有人":"Someone","想加你为好友":"wants to add you as a friend","待审核":"Pending Review","已冻结":"Frozen","已通过":"Approved","已驳回":"Rejected","已退回":"Returned","只打坚果牌，只信概率。":"Only play the nuts, only trust the odds.","男":"Male","系统公告":"System Announcement","欢迎来到德州扑克！本局为娱乐筹码，严禁任何形式的线下交易。":"Welcome to Texas Hold'em! Chips are for entertainment only; any form of real-money trading is strictly prohibited.","有没有人一起上分？50/100 缺 2 个位置":"Anyone playing? 50/100 has 2 seats open","刚才那把同花顺太爽了哈哈哈哈":"That straight flush felt amazing hahaha","主播今晚 8 点开播，来捧场～":"Streamer goes live at 8pm tonight, come support","求个俱乐部收留，VPIP 22":"Looking for a club, VPIP 22","你已加入牌桌：50/100 德州扑克（9人桌）":"You joined the table: 50/100 Texas Hold'em (9-max)","这把有牌啊":"I've got a hand this time","每日登录奖励":"Daily Login Reward","恭喜获得今日登录奖励，请查收附件。":"Congrats on today's login reward, please claim the attachment.","VIP6 特权礼包":"VIP6 Privilege Pack","VIP管家":"VIP Concierge","您的 VIP6 每周礼包已到账，内含 10 万筹码与专属头像框（7天）。":"Your VIP6 weekly pack has arrived: 100,000 chips and an exclusive avatar frame (7 days).","尊贵头像框":"Prestige Avatar Frame","赛事名次奖励":"Tournament Rank Reward","赛事中心":"Tournament Center","您在「午夜狂欢赛」中获得第 18 名，奖励已发放。":"You finished 18th in \"Midnight Frenzy\"; the reward has been issued.","好友赠送":"Gift from a Friend","兄弟，拿去翻本，别再 All-in 送了。":"Bro, take these and rebuild — stop donating with All-in.","系统维护通知":"System Maintenance Notice","运营团队":"Operations Team","10 月 2 日 03:00-05:00 进行服务器维护，期间无法登录。":"Server maintenance on Oct 2, 03:00-05:00; login will be unavailable.","初出茅庐":"Rookie","完成 100 手牌":"Play 100 hands","同花顺大师":"Straight Flush Master","做出 10 次同花顺":"Make 10 straight flushes","百万富翁":"Millionaire","累计盈利 100 万":"Cumulative profit 1,000,000","万人斩":"Slayer of Ten Thousand","赢下 1000 个底池":"Win 1,000 pots","做出皇家同花顺":"Make a Royal Flush","扑克之神":"Poker God","连赢 10 局":"Win 10 hands in a row","社交达人":"Social Butterfly","添加 50 位好友":"Add 50 friends","赛事冠军":"Tournament Champion","获得一次 MTT 冠军":"Win one MTT title","互动道具·鸡蛋":"Interaction Item · Egg","向玩家扔鸡蛋":"Throw an egg at a player","互动道具·炸弹":"Interaction Item · Bomb","整蛊对手":"Prank your opponent","互动道具·鲜花":"Interaction Item · Flowers","送给对手":"Give to your opponent","互动道具·啤酒":"Interaction Item · Beer","干杯！":"Cheers!","改名卡":"Name Change Card","修改昵称一次":"Change your nickname once","记牌器（1天）":"Hand Tracker (1 day)","显示对手范围提示":"Show opponent range hints","尊贵头像框（7天）":"Prestige Avatar Frame (7 days)","VIP 专属头像框":"VIP Exclusive Avatar Frame","VIP体验卡（3天）":"VIP Trial Card (3 days)","体验 VIP3 特权":"Try VIP3 privileges","确定":"Confirm","提交":"Submit","请输入内容":"Please enter content","退出登录":"Log Out","确定要退出当前账号吗？":"Are you sure you want to log out of this account?","已退出登录":"Logged out","功能演示中":"Demo only","无限注德州扑克":"No-Limit Hold'em","最主流":"Most Popular","发 2 张底牌，依次发出翻牌 3 张、转牌、河牌":"Deal 2 hole cards, then the flop (3 cards), turn and river","四轮下注：翻牌前 / 翻牌 / 转牌 / 河牌":"Four betting rounds: pre-flop / flop / turn / river","加注无上限，可随时 All-in":"No cap on raises, you can go All-in at any time","盲注：小盲 / 大盲，可开强抓 Straddle 与前注 Ante":"Blinds: small blind / big blind, optional Straddle and Ante","常见变体：Ante 桌、Bomb Pot、Seven-Deuce 赏金局":"Common variants: Ante tables, Bomb Pot, Seven-Deuce bounty","新手首选。位置、起手牌范围与筹码管理是最重要的三项基本功。":"Best for beginners. Position, starting hand range and bankroll management are the three core fundamentals.","底池限注奥马哈":"Pot-Limit Omaha","策略深":"Deep Strategy","发 4 张底牌，成手必须用且仅用 2 张底牌":"Deal 4 hole cards; you must use exactly 2 of them","底池限注：最大加注 = 当前底池 + 2 倍跟注额":"Pot-limit: max raise = current pot + 2x the call amount","公共牌同样是 5 张（翻 3 / 转 / 河）":"The board is also 5 cards (3 / turn / river)","常见强牌：同花连张 + 对子（如 A♠K♠Q♦J♦）":"Common strong hands: suited connectors plus a pair (e.g. A♠K♠Q♦J♦)","听牌多、波动大，胜率优势通常更薄":"Lots of draws and high variance; equity edges are usually thinner","只打「可发展的强听牌」和坚果潜力牌，避免用单对去拼大底池。":"Only play strong developing draws and nut-potential hands; avoid stacking off with one pair.","奥马哈5 / Big O":"Omaha 5 / Big O","大波动":"High Variance","发 5 张底牌，成手必须用且仅用 2 张底牌":"Deal 5 hole cards; you must use exactly 2 of them","底池限注，最大加注为一个底池":"Pot-limit; max raise is one pot","常见为 Big O（5 张奥马哈高低） 或纯高牌版本":"Usually Big O (5-card Omaha Hi-Lo) or a pure high version","坚果牌要求更高，谨慎追第二坚果":"The nut requirement is higher; be cautious chasing the second nuts","只追坚果，避免在大底池里用非坚果成手全下。":"Chase only the nuts; avoid getting all-in with non-nut hands in big pots.","奥马哈高低 Hi-Lo":"Omaha Hi-Lo","分池":"Split Pot","成手必须用且仅用 2 张底牌 + 3 张公共牌":"You must use exactly 2 hole cards plus 3 community cards","低牌：5 张牌点数均 ≤ 8 且互不重复（A 算 1）":"Low hand: 5 cards all ranked 8 or lower with no pairs (A counts as 1)","低牌比较：从最大牌往下比，越小越好":"Lows are compared from the highest card down; the lower the better","同时持有最高与最低（Scoop）可通吃整个底池":"Holding both the highest and lowest (Scoop) wins the whole pot","无低牌时高牌独得底池":"With no low, the high hand takes the whole pot","优先起手 A-2-x-x 这类同时具备坚果低牌与同花潜力的牌。":"Prioritize A-2-x-x style hands with nut-low and flush potential.","刺激":"Action","牌堆 36 张（6 7 8 9 10 J Q K A）":"36-card deck (6 7 8 9 10 J Q K A)","A 可作低牌：A-6-7-8-9 成立为顺子":"A plays low: A-6-7-8-9 makes a straight","通常带 Ante，盲位结构常见 Button 下 Ante":"Usually with an ante; button ante structures are common","对子与听牌胜率显著高于标准德州":"Pairs and draws have significantly higher equity than standard Hold'em","起手牌范围大幅放宽，中等对子价值提升，注意同花与葫芦的大小关系反转。":"Starting ranges widen a lot; mid pairs gain value, and note that flush vs. full house rankings are reversed.","只能全下或弃牌，没有跟注与加注。每手牌在几秒内结束，节奏极快。":"All-in or fold only — no calling or raising. Every hand ends within seconds at a very fast pace.","每手只有两个选项：All-in 或 Fold":"Only two options each hand: All-in or Fold","盲注按人数与位置自动分配":"Blinds are assigned automatically by player count and position","通常 3~6 人桌，一手牌 5 秒内结束":"Usually 3-6 players; a hand ends within 5 seconds","牌力与位置决定一切，无翻后操作":"Hand strength and position decide everything; no post-flop play","收紧起手范围，只打前 15% 左右的强牌，位置越靠后越松。":"Tighten your range to roughly the top 15%; loosen up as your position gets later.","极速桌 Rush & Cash":"Rush & Cash","高频率":"High Frequency","弃牌后立即被分配到新的牌桌继续下一手，无需等待，每小时手牌数翻倍。":"After folding you're instantly moved to a new table for the next hand — no waiting, double the hands per hour.","弃牌后立刻换桌开新的一手":"Fold and you're moved to a new table for the next hand immediately","牌池玩家为匿名轮换，降低被读牌风险":"The player pool rotates anonymously, reducing the risk of being read","常见 4~6 人桌":"Usually 4-6 players","适合大量手牌快速积累数据与返水":"Great for racking up volume, stats and rakeback fast","节奏极快，适合熟悉标准的玩家刷手牌量与返水。":"Very fast — good for experienced players grinding volume and rakeback.","单挑 Heads-Up":"Heads-Up","对抗":"Heads-Up","一对一单挑，按钮位同时是小盲并先行动（翻牌前），翻后最后行动。":"One-on-one; the button is also the small blind and acts first pre-flop, last post-flop.","仅 2 名玩家对局":"Only 2 players","按钮位下小盲，翻牌前先行动、翻后后行动":"The button posts the small blind, acts first pre-flop and last post-flop","起手范围极宽，几乎每手都要参与":"Starting ranges are extremely wide — you play almost every hand","位置优势每手轮换":"The positional advantage alternates every hand","aggression 是关键，多用持续下注与 float，避免在翻后被动。":"Aggression is key — c-bet and float often, avoid playing passively post-flop.","疯狂菠萝":"Crazy Pineapple","趣味":"Fun","发 3 张底牌，翻牌后弃掉 1 张，再用剩余 2 张 + 公共牌组成牌型。":"Deal 3 hole cards; after the flop discard 1, then use the remaining 2 plus the board.","每人发 3 张底牌":"Each player gets 3 hole cards","翻牌发出后必须先弃 1 张底牌":"You must discard 1 hole card after the flop","转牌前再弃 1 张（Crazy Pineapple 为翻牌后弃 1 张）":"Discard another before the turn (Crazy Pineapple discards 1 after the flop)","其余规则与无限注德州一致":"All other rules match No-Limit Hold'em","多一张底牌让成牌率上升，起手牌价值整体提高，注意保留同花与连张潜力。":"An extra hole card raises how often you make a hand and boosts starting hand values; keep suited and connected potential.","赛事":"Tournament","满员即开的单桌锦标赛，报名费含赛事服务费（约 10%），按名次分配奖池。":"A single-table tournament that starts when full; entry fee includes a service fee (about 10%), and the prize pool is paid by finishing position.","报名费 = 奖池 + 服务费（常见 5%~10%）":"Entry fee = prize pool + service fee (usually 5%-10%)","盲注逐级上涨，筹码不能带出牌桌":"Blinds increase by level; chips cannot be taken off the table","按名次分配奖池，常见 6 人桌 3 名入奖":"Prize pool paid by rank; commonly 3 paid spots at a 6-max table","不可中途买入（部分支持 Rebuy/Add-on）":"No mid-game buy-in (some support Rebuy/Add-on)","中后期 ICM 压力显著，短码要抢盲，大码要压制对手。":"ICM pressure is significant late — short stacks must steal blinds, big stacks should apply pressure.","大额奖池":"Big Prize Pool","多桌同时进行的大型锦标赛，设有保底奖池，逐桌合并直至决赛桌。":"A large multi-table tournament with a guaranteed prize pool; tables merge down to the final table.","固定开赛时间或达到人数即开赛":"Fixed start time, or starts once enough players register","盲注等级每 8~15 分钟上涨":"Blind levels increase every 8-15 minutes","含 Ante 阶段与封盘休息":"Includes ante stages and scheduled breaks","奖池按名次分配，冠军占比最高":"Prize pool is paid by rank, with the largest share to the champion","支持重买 Rebuy / 加购 Add-on / 分阶段 Day2":"Supports Rebuy / Add-on / multi-day Day 2","前期紧、中期抢、后期按 ICM 决策；关注泡沫期与奖励跳跃。":"Tight early, aggressive mid, ICM-based late; watch the bubble and payout jumps.","Spin & Go 随机奖池":"Spin & Go Random Prize Pool","随机倍率":"Random Multiplier","3 人桌，开赛即定奖池倍率":"3-max; the prize multiplier is set at the start","初始筹码通常为 25~50BB，盲注快速上涨":"Starting stacks are usually 25-50BB with fast-rising blinds","冠军独得奖池（部分平台按名次）":"Winner takes the pool (some platforms pay by rank)","服务费约为报名费的 6%~10%":"Service fee is about 6%-10% of the entry fee","浅筹码对抗，熟记推牌/跟注范围表是关键。":"Short-stack play — memorizing push/fold ranges is the key.","赛事服务费":"Tournament Service Fee","抽水":"Rake","% · 上限":"% · Cap","小盲":"Small Blind","大盲":"Big Blind","第":"","手开始，":"onwards, blinds","，盲注":", blinds","跟注 All-in":"Call All-in","翻牌：":"Flop:","转牌：":"Turn:","河牌：":"River:","低牌":"Low Hand","高牌独得":"High hand takes all","主池":"Main Pot","摊牌结束":"Showdown complete","真人":"Human","机器人":"Bot","50/100 德州扑克":"50/100 Texas Hold'em","10/20 德州扑克":"10/20 Texas Hold'em","200/400 短牌":"200/400 Short Deck","5/10 德州扑克":"5/10 Texas Hold'em","大厅":"Lobby","该牌桌需要 VIP4 以上":"This table requires VIP4 or above","该牌桌已设置密码":"This table is password protected","请输入房间密码":"Please enter the room password","请输入房主设置的密码":"Please enter the password set by the host","百万俱乐部赛":"Millionaire Club","每晚 20:00 · 保底奖励 5亿筹码（≈500万 USDT）":"Every night 20:00 · 500M chips guaranteed (≈5M USDT)","筹码支持充值":"Chips can be purchased","USDT 充值 · 签到 / 任务免费领 · 提现走风控审核":"USDT deposits · free chips from check-in / tasks · withdrawals go through risk review","新手福利":"New Player Bonus","登录 7 天领 100 万筹码":"Log in 7 days to claim 1,000,000 chips","锦标赛":"Tournaments","搜索牌桌 / 房间号":"Search table / room No.","均池":"Avg Pot","留空则无需密码":"Leave blank for no password","输入 6 位房间号":"Enter the 6-digit room No.","房间密码（若有）":"Room password (if any)","请输入正确房间号":"Please enter a valid room No.","加入中…":"Joining…","已进入房间":"Room entered","已接受邀请并进入房间":"Invitation accepted and room entered","这是私有房，需要房主邀请并你同意":"This is a private room; the host must invite you and you must accept","加入失败":"Failed to join","俱乐部":"Club","锦标赛 / MTT":"Tournaments / MTT","午夜狂欢赛":"Midnight Frenzy","2万筹码报名":"20K chip entry","20:00 开赛":"Starts 20:00","保底 5亿筹码":"500M chips guaranteed","周日百万赛":"Sunday Million","10万筹码报名":"100K chip entry","20:30 开赛":"Starts 20:30","保底 20亿筹码":"2B chips guaranteed","快速狙击赛":"Quick Sniper","5000筹码报名":"5,000 chip entry","滚动开赛":"Rolling start","即时开打":"Starts instantly","VIP 邀请赛":"VIP Invitational","门票 x1":"Ticket x1","21:00 开赛":"Starts 21:00","保底 8亿筹码":"800M chips guaranteed","筛选牌桌":"Filter Tables","牌桌已刷新":"Tables refreshed","牌桌已刷新（未连上服务器）":"Tables refreshed (server not connected)","活动页面演示":"Event page demo","同意后才会入座，你不同意谁也拉不动你":"You're seated only after you accept — no one can pull you in otherwise","立即参与":"Join Now","牌桌列表":"Table List","没有符合条件的牌桌":"No tables match your filters","邀请你加入":"invited you to join","我的房":"My Room","创建房间":"Create Room","房间名称":"Room Name","游戏类型":"Game Type","短牌":"Short Deck","奥马哈":"Omaha","买入范围（BB）":"Buy-in Range (BB)","房间密码（6位，可留空）":"Room password (6 digits, optional)","好友可观看你的牌局":"Friends can watch your game","我的房间":"My Rooms","等你接受邀请":"Waiting for you to accept","还没有房间":"No rooms yet","创建俱乐部":"Create Club","报名":"Register","桌型":"Table Size","仅显示有空位":"Show seats available only","仅显示开启保险":"Show insurance tables only","隐藏满员牌桌":"Hide full tables","应用筛选":"Apply Filters","请输入密码":"Please enter password","请先同意用户协议":"Please accept the User Agreement first","登录中…":"Logging in…","登录成功，欢迎回来":"Login successful, welcome back","账号已被封禁":"This account has been banned","服务器不可用，已进入离线模式":"Server unavailable, entered offline mode","登录失败（":"Login failed (","游客登录":"Guest Login","游客数据保存在本机，卸载后可能丢失。":"Guest data is stored locally and may be lost after uninstalling.","进入游戏":"Enter Game","注册新账号":"Register New Account","给自己起个牌桌ID":"Pick yourself a table ID","至少 6 位":"At least 6 characters","请输入手机号":"Please enter your phone number","好友的 ID，可不填":"Friend's ID, optional","账号格式不正确":"Invalid account format","请输入昵称":"Please enter a nickname","请输入有效的 11 位中国手机号":"Please enter a valid 11-digit Chinese phone number","请输入有效的 10 位美国手机号":"Please enter a valid 10-digit US phone number","注册中…":"Registering…","注册成功，请先充值再上桌":"Registration successful, please deposit before playing","服务器不可用，已用本机账号进入":"Server unavailable, signed in with a local account","注册失败（":"Registration failed (","找回密码":"Recover Password","我知道了":"Got it","请提供以下信息联系在线客服人工找回：":"Please provide the following info to contact live support for manual recovery:","① 账号 / 昵称":"① Account / Nickname","德 州 扑 克":"TEXAS HOLD'EM","其他方式登录":"Other Login Methods","我已阅读并同意":"I have read and agree to","《用户协议》":"\"User Agreement\"","与":" and ","《隐私政策》":"\"Privacy Policy\"","服务器：亚洲一区 · 流畅":"Server: Asia Zone 1 · Smooth","记住账号":"Remember Account","忘记密码？":"Forgot password?","还没有账号？":"No account yet?","立即注册":"Register Now","账号（4-16 位字母数字）":"Account (4-16 letters or digits)","手机号码":"Phone Number","中国 +86":"China +86","美国 +1":"United States +1","推荐人 ID（选填）":"Referrer ID (optional)","钱包":"Wallet","向好友转账 / 记录":"Transfer to Friends / History","背包":"Bag","件道具":"items","封未读":"unread","每日 / 成长任务":"Daily / Growth Tasks","位好友 ·":"friends ·","条申请":"requests","成就":"Achievements","12 种主流玩法规则":"12 Popular Game Variants","抽水上限与 VIP 返水":"Rake Cap and VIP Rakeback","每邀请 1 人得":"Per friend invited you get","已绑定手机":"Phone number bound","音效 / 隐私 / 关于":"Sound / Privacy / About","在线客服 · 常见问题":"Live Support · FAQ","德州扑克玩法规则":"Texas Hold'em Rules","网络不可用，需要联网才能领取":"Network unavailable, an internet connection is required to claim","任务奖励已领取 +":"Task reward claimed +","已跳转到对应玩法":"Jumped to the corresponding variant","签到中…":"Checking in…","网络不可用，需要联网签到":"Network unavailable, an internet connection is required to check in","1. 好友在注册页「推荐人 ID」填你的邀请码；":"1. Your friend enters your invite code in \"Referrer ID\" on the registration page;","3. 奖励数值由后台「参数配置 → 邀请好友奖励」控制（当前":"3. The reward amount is set in Admin \"Parameters → Invite Reward\" (currently","筹码 / 人）；":"chips / person);","4. 每人每天最多领 20 笔，超过当天不再发放（防刷号）。":"4. Max 20 payouts per person per day; beyond that nothing is paid that day (anti-abuse).","邀请码已复制":"Invite code copied","提现要先把筹码":"To withdraw you must first convert your chips","筹码是场内余额，USDT 是可提取余额，两者分开。":"Chips are in-game balance, USDT is withdrawable balance; the two are separate.","中途断签会重新从第 1 天开始。签到筹码为娱乐筹码，不可兑换 USDT。":"Missing a day resets you to day 1. Check-in chips are for entertainment and cannot be converted to USDT.","VPIP 入池率":"VPIP","PFR 加注率":"PFR","WTSD 摊牌率":"WTSD","W$SD 摊牌胜率":"W$SD","综合胜率":"Overall Win Rate","网络不可用，无法读取邮件":"Network unavailable, cannot load mail","读取失败":"Failed to load","封邮件附件，共 +":"mail attachments, total +","已领取 +":"Claimed +","本平台提供的德州扑克游戏为":"The Texas Hold'em game provided by this platform is","。游戏内「筹码」为虚拟道具，不具备任何法偿性，":". In-game \"chips\" are virtual items with no legal tender status,","1. 注册用户须年满 18 周岁，并保证注册信息真实、准确。":"1. Registered users must be at least 18 years old and ensure their registration info is true and accurate.","3. 账号不得出借、转让、出售。因账号保管不善造成的后果由用户自行承担。":"3. Accounts may not be lent, transferred or sold. The user bears all consequences of poor account custody.","1. 筹码来源：签到、任务、活动发放，或使用 USDT 充值购买。":"1. Sources of chips: check-in, tasks, event rewards, or purchase with a USDT deposit.","2. 兑换与提现：仅":"2. Conversion and withdrawal: only","部分的筹码可兑换为 USDT 并申请提现；":"of your chips can be converted to USDT and withdrawn;","游戏过程中赢得的净盈利只可用于继续游戏，不可兑现。":"Net winnings from play can only be used to keep playing and cannot be cashed out.","3. 提现需通过实名认证，并按平台公示规则收取单笔固定手续费。":"3. Withdrawals require ID verification, and a flat per-transaction fee is charged per the platform's published rules.","使用外挂、脚本、多开协同作弊；利用系统漏洞套利；洗钱、套现、非法资金中转；":"Using cheats, scripts or multi-account collusion; exploiting system bugs for profit; money laundering, cashing out, or illegal fund transfers;","因网络、设备、运营商、不可抗力导致的服务中断，平台不承担责任。":"The platform is not liable for service interruptions caused by network, device, carrier or force majeure.","本协议可能随法律法规与业务调整而更新，更新后继续使用即视为接受。":"This agreement may be updated as laws and business change; continuing to use the service means acceptance.","3. 游戏数据：牌局记录、筹码流水，用于提供服务、处理争议与反作弊。":"3. Game data: hand history and chip transactions, used to provide the service, resolve disputes and prevent cheating.","提供服务与客服支持；风险控制（识别异常登录、批量注册、套利行为）；":"Providing the service and customer support; risk control (detecting abnormal logins, bulk registrations, arbitrage behavior);","履行反洗钱与合规义务；在匿名化、聚合化前提下做产品统计。":"Fulfilling anti-money-laundering and compliance obligations; product statistics under anonymized, aggregated conditions.","应法律法规或有权机关的强制要求。":"As required by laws, regulations or competent authorities.","你可通过「我的 → 客服工单」申请查询、更正或删除你的个人信息；":"You can request to access, correct or delete your personal info via \"Me → Support Ticket\";","也可通过设置关闭聊天、好友邀请等社交功能。":"You can also disable chat, friend invites and other social features in Settings.","密码使用 scrypt 加盐哈希存储；管理后台独立鉴权；":"Passwords are stored as salted scrypt hashes; the admin backend uses separate authentication;","所有后台操作写入审计日志；数据每日本地备份。":"All backend actions are written to an audit log; data is backed up locally every day.","请妥善保管账号与支付密码，不要向任何人透露。":"Keep your account and payment password safe; never disclose them to anyone.","用户协议":"User Agreement","隐私政策":"Privacy Policy","我的成就":"My Achievements","（未设置，转账前请先设置）":"(Not set, please set it before transferring)","修改登录密码":"Change Login Password","新密码（至少 6 位）":"New password (at least 6 characters)","登录密码已修改":"Login password changed","设置支付密码":"Set Payment Password","6 位数字密码":"6-digit numeric password","用于转账":"Used for transfers","支付密码需为 6 位数字":"The payment password must be 6 digits","支付密码已设置，转账时需要使用":"Payment password set; it will be required for transfers","设置失败":"Setup failed","实名认证仅供演示，不会上传真实信息。":"ID verification is demo only; no real information is uploaded.","前往认证":"Go Verify","认证成功（演示）":"Verified (demo)","设备管理（演示）":"Device Management (demo)","登录日志（演示）":"Login Log (demo)","游戏音效":"Game Sound","人声播报（牌桌动作）":"Voice Announcements (table actions)","自动买入":"Auto Buy-in","自动补码":"Auto Top-up","显示胜率提示":"Show Equity Hints","允许陌生人私信":"Allow messages from strangers","允许好友邀请":"Allow friend invites","允许接收转账":"Allow incoming transfers","设置已保存":"Settings saved","语言切换（演示）":"Language Switch (demo)","将清除本地图片与日志缓存。":"This will clear local image and log caches.","清除":"Clear","缓存已清除":"Cache cleared","关于":"About","充值未到账":"Deposit not received","道具未到账":"Item not received","账号问题":"Account Issue","举报作弊":"Report Cheating","提现申请进度":"Withdrawal Status","规则咨询":"Rules Question","BUG 反馈":"Bug Report","如何购买保险？|All-in 时系统会自动弹出保险窗口，点击立即投保即可。":"How do I buy insurance?|The insurance window pops up automatically when All-in; just tap \"Insure Now\".","为什么我无法转账？|需设置支付密码，且当日转账额度未超限。":"Why can't I transfer?|You need a payment password and must not exceed the daily transfer limit.","筹码怎么充？怎么提？|充值按 1 USDT =":"How do I deposit and withdraw chips?|Deposits convert at 1 USDT =","筹码折算，审核到账。提现要先把筹码在钱包里":"chips, credited after review. To withdraw, first convert chips in your wallet","VPIP 是什么意思？|VPIP 表示主动入池率，是重要的扑克数据指标。":"What does VPIP mean?|VPIP is Voluntarily Put Money In Pot, an important poker statistic.","输入您的问题…":"Type your question…","已转接人工客服（演示）":"Transferred to a human agent (demo)","保存中…":"Saving…","处理中…":"Processing…","✘ 图片读取失败":"✘ Failed to read image","上传中…":"Uploading…","上传失败":"Upload failed","恢复失败":"Restore failed","已恢复为默认头像":"Default avatar restored","个人资料":"Profile","修改昵称":"Change Nickname","新昵称（2-16 字）":"New nickname (2-16 characters)","网络不可用，无法修改昵称":"Network unavailable, cannot change nickname","昵称已更新":"Nickname updated","修改签名":"Change Signature","已更新":"Updated","选择性别":"Select Gender","地区选择（演示）":"Region Selection (demo)","头像框（演示）":"Avatar Frame (demo)","我的筹码":"My Chips","我的邀请码":"My Invite Code","好友注册时把「推荐人 ID」填成这串数字即可":"Friends just enter this number in \"Referrer ID\" when registering","复制邀请码":"Copy Invite Code","已成功邀请":"Successfully invited","每人奖励":"Reward per person","邀请规则":"Invite Rules","我的钱包":"My Wallet","筹码（场内）":"Chips (in-game)","USDT 余额（可提现）":"USDT Balance (withdrawable)","兑换":"Convert","充值是":"Deposits are","U 兑换成筹码":"USDT converted into chips","资金流水":"Transaction History","今日已签":"Checked in today","签到":"Check In","每日签到":"Daily Check-in","任务奖励已下线，筹码请通过充值获得":"Task rewards are discontinued; please get chips by depositing","近 30 天盈亏曲线":"Last 30 Days P&L","30 天前":"30 days ago","时间":"Time","今天":"Today","核心数据":"Core Stats","生涯":"Career","总手牌数":"Total Hands","累计盈利":"Cumulative Profit","最大底池":"Biggest Pot","最大连胜":"Longest Win Streak","12 局":"12 hands","0 次":"0 times","数据仅供娱乐统计，不作为任何投注建议":"Data is for entertainment statistics only and is not betting advice","暂时没有邮件":"No mail yet","系统通知、后台公告、转账到账提醒都会出现在这里":"System notices, announcements and transfer alerts appear here","全服":"Server-wide","附件需要在邮件里主动领取，领取后即时到账":"Attachments must be claimed in the mail; they are credited instantly","一、服务性质":"I. Nature of the Service","二、账户与年龄":"II. Accounts and Age","三、虚拟道具与资金":"III. Virtual Items and Funds","四、禁止行为":"IV. Prohibited Conduct","五、免责与变更":"V. Disclaimer and Changes","一、我们收集的信息":"I. Information We Collect","二、我们使用信息的目的":"II. How We Use Your Information","三、信息的共享":"III. Sharing of Information","四、你的权利":"IV. Your Rights","五、安全措施":"V. Security Measures","最后更新：2026-10-02 · 如有疑问请通过「我的 → 客服工单」联系":"Last updated: 2026-10-02 · For questions, contact us via \"Me → Support Ticket\"","已获得":"Unlocked","未解锁":"Locked","手机号":"Phone Number","已绑定":"Bound","登录密码":"Login Password","建议 90 天更换一次":"We recommend changing it every 90 days","支付密码":"Payment Password","未认证将限制部分功能":"Without verification some features are limited","未认证":"Not Verified","登录设备管理":"Login Device Management","3 台设备":"3 devices","登录日志":"Login Log","最近 5 条记录":"Last 5 records","音效与画面":"Sound & Display","游戏":"Game","隐私与通知":"Privacy & Notifications","语言":"Language","简体中文":"Simplified Chinese","当前缓存 128 MB":"Current cache 128 MB","关于我们":"About Us","版本 v3.8.2":"Version v3.8.2","德州扑克 UI Demo":"Texas Hold'em UI Demo","本 Demo 仅用于界面展示，所有数据均为虚拟数据":"This demo is for interface display only; all data is virtual","在线客服":"Live Support","客服小助手 · 在线":"Support Assistant · Online","您好，请问有什么可以帮您？":"Hello, how can I help you?","发送":"Send","高牌。":"High card.","本应用为纯界面演示，不涉及任何真实货币交易与赌博行为，请理性娱乐。":"This app is a pure interface demo with no real-money trading or gambling. Please play responsibly.","当前头像":"Current Avatar","上传图片":"Upload Image","恢复默认":"Restore Default","系统头像":"System Avatars","性别":"Gender","地区":"Region","头像框":"Avatar Frame","尊贵金框":"Prestige Gold Frame","手牌":"Hand","胜率":"Equity","盈利":"Profit","微额 (5/10 ~ 10/20)":"Micro (5/10 ~ 10/20)","新手桌":"Beginner Table","小额 (25/50 ~ 50/100)":"Small (25/50 ~ 50/100)","最热门":"Most Popular","中额 (100/200 ~ 500/1000)":"Mid (100/200 ~ 500/1000)","常规桌":"Regular Table","高额 (1000/2000 以上)":"High (1000/2000 and up)","VIP 桌":"VIP Table","快速桌":"Fast Table","36 张牌":"36 cards","报名费 8%":"Entry Fee 8%","底池限注":"Pot-Limit","固定限注":"Fixed-Limit","全下/弃牌":"All-in/Fold","无限注":"No-Limit","注意不能同时使用 3 张底牌。":"Note you cannot use all 3 hole cards.","同时拿到最高与最低称 Scoop，通吃全池。":"Holding both the highest and lowest is called Scoop and wins the entire pot.","· 规则说明":"· Rules","· 前注":"· Ante","抽水什么时候扣？":"When is rake taken?","手牌结算时从主池扣除，未发出翻牌则不扣。":"It's deducted from the main pot at settlement; no rake if no flop is dealt.","有上限吗？":"Is there a cap?","有，按大盲倍数封顶，级别越高上限越宽松。":"Yes, capped by big blind multiples; higher stakes have looser caps.","返水怎么发？":"How is rakeback paid?","每手结算后按 VIP 等级即时返还到筹码账户。":"Paid instantly to your chip balance after each hand based on your VIP level.","边池会重复抽水吗？":"Are side pots raked again?","不会，一手牌只抽一次，从主池扣除。":"No, each hand is raked once, from the main pot only.","锦标赛怎么收费？":"How are tournaments charged?","按报名费的服务费比例（常见 8%~10%）一次性收取。":"A one-time service fee based on the entry fee (usually 8%-10%).","常规":"Regular","快速":"Fast","创建房间 · 邀请好友":"Create Room · Invite Friends","留空则好友可直接进入":"Leave blank so friends can enter directly","需要密码":"Password required","房间已创建，但邀请没发出去：":"Room created, but the invite wasn't sent:","请到牌桌内点「邀请好友」重试":"Please tap \"Invite Friends\" at the table and retry","房间已创建，已向":"Room created, invite sent to","位好友发出邀请 · 等对方同意":"friends · waiting for them to accept","房间创建成功":"Room created","好友需要同意邀请才能进来":"Friends must accept the invite to join","进入房间":"Enter Room","这个房间还没有服务端房间号，请重新创建":"This room has no server-side room No. yet, please create it again","已经邀请过了，等对方同意":"Already invited, waiting for them to accept","邀请发送失败":"Failed to send invite","已邀请":"Invited","· 等对方同意":"· waiting for acceptance","房间已解散或网络不可用":"Room dissolved or network unavailable","房间成员已更新 ·":"Room members updated ·","人在座":"seated","点「规则」查看完整玩法说明，点「建房」可创建房间邀请好友同玩":"Tap \"Rules\" for full variant details, tap \"Create\" to make a room and invite friends","热门":"Popular","所有玩法均为虚拟币娱乐，无任何真实货币交易":"All variants are virtual-chip entertainment with no real-money transactions","示例：奥马哈成手判定":"Example: Omaha hand evaluation","底牌":"Hole Cards","公共牌":"Board","示例：短牌 6+特殊牌型":"Example: Short Deck 6+ special hands","示例：高低分池":"Example: Hi-Lo pot split","核心规则":"Core Rules","抽水 / 服务费":"Rake / Service Fee","玩法建议":"Strategy Tips","开始游戏":"Start Game","建房邀请好友":"Create Room & Invite","抽水与返水规则":"Rake & Rakeback Rules","什么是抽水（Rake）":"What is Rake","平台从每个底池收取的服务费，只在":"The service fee the platform takes from each pot, only","翻牌发出后":"after the flop is dealt","产生；翻牌前结束的手牌不抽水（No Flop No Drop）。":"; hands that end pre-flop are not raked (No Flop No Drop).","常规抽水表":"Standard Rake Table","抽水计算示例":"Rake Calculation Examples","底池 10,000 · 中额 5%":"Pot 10,000 · Mid stakes 5%","抽水 500":"Rake 500","底池 50,000 · 中额 5%（上限 3BB=600）":"Pot 50,000 · Mid stakes 5% (cap 3BB=600)","抽水 600（封顶）":"Rake 600 (capped)","底池 8,000 · 翻牌前结束":"Pot 8,000 · ended pre-flop","不抽水":"No rake","抽水从主池扣除，边池不额外抽水；保险赔付与抽水相互独立。":"Rake is taken from the main pot; side pots are not raked again. Insurance payouts are independent of rake.","VIP 返水（Rakeback）":"VIP Rakeback","具体抽水以所在牌桌规则为准":"The actual rake follows the rules of the table you're on","① 选择玩法":"① Select Variant","② 盲注级别":"② Blind Level","③ 房间设置":"③ Room Settings","房间密码（6 位，可留空）":"Room password (6 digits, optional)","开启强抓 Straddle":"Enable Straddle","大盲后可加倍下注":"Double the bet after the big blind","下一步：邀请好友":"Next: Invite Friends","房间已配置":"Room configured","选择好友入座（可多选）":"Select friends to seat (multi-select)","先到「好友」页加几个人，回来就能邀请他们入座":"Add a few friends on the \"Friends\" page first, then come back to invite them","上一步":"Previous","没同意之前，谁也不会被拉进来。":"Until they accept, no one gets pulled in.","继续邀请好友":"Continue Inviting Friends","好友同意后才会真正入座，未同意不会出现在牌桌上。":"Friends are seated only after they accept; otherwise they won't appear at the table.","刷新成员":"Refresh Members","点一下调一次 TTS API":"Each tap calls the TTS API once","全下":"All-in","先说半句":"Say half a sentence","没交互就出声":"Speak when idle","说点什么…":"Say something…","· 私聊":"· Private Message","输入消息…":"Type a message…","消息太长（最多 500 字）":"Message too long (max 500 characters)","发送失败，对方可能收不到":"Failed to send; the recipient may not receive it","赠送金币给":"Gift coins to","最少赠送 1000":"Minimum gift is 1,000","已赠送":"Gift sent","给":"to","在好友里搜索（昵称 / ID）":"Search friends (nickname / ID)","游戏中 ·":"In game ·","在线":"Online","离线 ·":"Offline ·","离线":"Offline","你有":"You have","条好友申请还没处理，点上面的「申请」tab 通过一下 →":"unhandled friend requests, go to the \"Requests\" tab above to approve them →","点右上角「+」输入对方的 ID 或昵称，对方同意后两边好友列表都会出现":"Tap \"+\" at the top right and enter their ID or nickname; once they accept, you'll both see each other","暂无好友申请":"No friend requests","别人申请加你的时候会出现在这里":"Requests from other players appear here","等待对方同意":"Waiting for acceptance","没有等待回复的申请":"No pending requests","你发出的好友申请会显示在这里；对方点「同意」之后，双方好友列表才同时出现":"Requests you've sent appear here; both friend lists update only after they tap \"Accept\"","黑名单为空":"Blocklist is empty","拉黑后对方不能再向你发起好友申请":"Blocked players can no longer send you friend requests","好友列表拉取失败，请稍后重试":"Failed to load friend list, please try again later","已添加为好友":"Added as friend","已撤回申请":"Request withdrawn","已解除拉黑":"Unblocked","房间邀请":"Room Invites","· 需要密码":"· password required","玩家资料":"Player Profile","选择要请进来的好友":"Select friends to invite","当前牌桌不是服务端房间，没法拉好友进来；点「建房一起玩」再选他即可":"This table isn't a server room, so you can't pull friends in; tap \"Create Room & Play\" then select them","添加好友":"Add Friend","输入玩家 ID 或昵称":"Enter player ID or nickname","请输入 ID 或昵称":"Please enter an ID or nickname","搜索失败":"Search failed","请检查网络后重试":"Please check your connection and retry","没有找到玩家":"No player found","确认 ID 或昵称是否输对；也可以让好友把他的 ID 发给你":"Double-check the ID or nickname; you can also ask your friend to send you their ID","· 等对方点「同意」，两边好友列表才会同时出现":"· both friend lists update only after they tap \"Accept\"","我的名片":"My Card","暂无消息":"No messages","暂无私聊，去好友列表找人聊聊":"No private messages yet, find someone to chat with","世界":"World","自定义金额":"Custom Amount","留言（选填）":"Message (optional)","每日赠送上限 200 万，赠送需手续费 2%":"Daily gift cap is 2,000,000; gifts carry a 2% fee","确认赠送":"Confirm Gift","申请":"Requests","黑名单":"Blocklist","详情":"Details","撤回":"Withdraw","解除":"Unblock","查看":"View","暂时没有房间邀请":"No room invites yet","好友建私有房并邀请你时，会出现在这里":"Appears here when a friend creates a private room and invites you","同意之后才会进房间；你不同意，谁也拉不动你。":"You enter only after accepting; if you don't, no one can pull you in.","接受并进入":"Accept & Enter","等级":"Level","会员":"Member","赠送筹码":"Gift Chips","建房一起玩":"Create Room & Play","邀请入桌":"Invite to Table","删除好友":"Delete Friend","搜索玩家":"Search Players","我的 ID":"My ID","把这串数字给好友，他就能搜到你":"Give this number to a friend so they can find you","复制":"Copy","这是你自己":"This is you","已是好友":"Already friends","同意":"Accept","已申请":"Requested","不可添加":"Cannot add","加好友":"Add Friend","搜索中…":"Searching…","我的玩家 ID":"My Player ID","复制 ID":"Copy ID","好友在「好友 → 右上角 +」里输入这串 ID 就能搜到你":"Friends can enter this ID via \"Friends → +\" to find you","你已经在座了":"You're already seated","买入后才能入座":"You must buy in before taking a seat","已入座 · 等这一局打完就发牌给你":"Seated · you'll be dealt in once this hand finishes","这个房间暂时只有你一个人 · 等好友接受邀请才会开局，这里不安排机器人陪坐":"You're alone for now · play starts when friends accept; no bots are seated here","位已同意邀请的好友在座":"friends who accepted are seated","牌桌菜单":"Table Menu","筹码（≈":"chips (≈","· 第":"· Hand","手 ·":"·","摊牌":"Showdown","等待":"Waiting","平台抽水":"Platform Rake","（返水 +":"(rakeback +","手牌强度":"Hand Strength","· 底池赔率":"· Pot Odds","· 成手：":"· Made hand:","· 低牌：":"· Low hand:","有":"Yes","无":"No","先入座并买入（账户":"Take a seat and buy in (account","）才会给你发牌":") to be dealt in","账户余额为 0 · 入座时会先引导你充值":"Account balance is 0 · you'll be prompted to deposit when seating","牌桌筹码为 0 · 点「买入」把账户余额（":"Table chips are 0 · tap \"Buy-in\" to move your account balance (","）划到桌上才会发牌、才能下注":") to the table before you're dealt in and can bet","牌桌和账户都是 0 · 请先充值，再买入上桌":"Both table and account are 0 · please deposit, then buy in","1/3 底池":"1/3 Pot","1/2 底池":"1/2 Pot","2/3 底池":"2/3 Pot","1 倍底池":"1x Pot","超时未操作，已自动":"Timed out, auto","疯狂菠萝 · 弃掉一张底牌":"Crazy Pineapple · Discard one hole card","翻牌后必须弃 1 张，用剩余 2 张 + 公共牌组成成手":"After the flop you must discard 1 and use the remaining 2 plus the board","确认保留这 2 张":"Confirm keeping these 2","请选择 2 张保留":"Select 2 cards to keep","已弃掉 1 张底牌":"Discarded 1 hole card","保险赔付 +":"Insurance payout +","保险未生效，保费":"Insurance not active, premium","已扣除":"deducted","赢得":"Won","·低牌":"·Low","· 平台抽水":"· Platform Rake","· VIP返水 +":"· VIP Rakeback +","本手结束":"Hand complete","入座成功 · 这手开始给你发牌":"Seated · you'll be dealt in starting this hand","自动补码 +":"Auto top-up +","牌桌筹码已输光，请先买入":"Table chips are gone, please buy in","牌桌和账户都是 0，请先充值再买入":"Both table and account are 0, please deposit then buy in","玩家不足，等待中…":"Not enough players, waiting…","已换到座位":"Seat changed","EV 保险":"EV Insurance","All-in 保护 · 亏损可获赔付":"All-in protection · get paid if you lose","不投保":"No Insurance","立即投保":"Insure Now","筹码不足，无法投保":"Not enough chips to buy insurance","投保成功，最高赔付":"Insured, max payout","（我）":"(me)","已加入黑名单":"Added to blocklist","操作失败":"Action failed","举报已提交，感谢反馈":"Report submitted, thanks for the feedback","已站起，下一手不参与":"Standing up, you'll sit out the next hand","已回到牌桌":"Back at the table","已亮牌（仅本手）":"Hole cards revealed (this hand only)","账户余额不足":"Insufficient account balance","当前筹码已足够":"Your stack is already sufficient","筹码不足":"Not enough chips","买入成功 +":"Buy-in successful +","桌上没有本金可取，赢来的筹码不可兑现":"No principal to cash out; winnings cannot be cashed out","已取回":"Returned","，剩余":", remaining","留在桌上（净盈利）":"stays on the table (net profit)","互动":"Interact","打得不错":"Well played","运气真好":"Lucky you","再来一把":"One more hand","这牌也能跟？":"You called with that?","我弃了":"I fold","好运！":"Good luck!","道具不足":"Not enough items","向对手扔了":"Threw","本桌":"This table","当前":"Current","· 对方同意才入座":"· seated only after they accept","本桌没有服务端房间号":"This table has no server-side room No.","从好友列表邀请":"Invite from friend list","房主设置":"Host Settings","你是房主，可管理本桌":"You're the host, you can manage this table","仅房主可用":"Host only","人排队中":"in queue","玩法规则":"Game Rules","牌局":"Hands","查看历史牌局":"View Hand History","本桌数据统计":"This Table's Stats","实时胜率与赔率":"Live Equity & Pot Odds","保险说明":"Insurance Info","本桌已开启":"Enabled at this table","本桌未开启":"Disabled at this table","互动与显示":"Interaction & Display","互动 / 表情":"Interaction / Emoji","道具、表情、快捷短语":"Items, emoji, quick phrases","与同桌玩家交流":"Chat with players at this table","音效 / 牌背 / 桌布":"Sound / Card Back / Felt","全屏":"Fullscreen","全屏显示牌桌":"Show the table fullscreen","其他":"Other","违规行为举报":"Report Misconduct","返回大厅":"Back to Lobby","牌桌菜单 ·":"Table Menu ·","全屏切换（演示）":"Fullscreen toggle (demo)","举报入口已打开（演示）":"Report panel opened (demo)","EV 保险说明":"EV Insurance Info","邀请好友同桌":"Invite Friends to This Table","你不是本房间的房主":"You are not the host of this room","房主设置 · 房间":"Host Settings · Room","位待对方同意":"waiting for acceptance","锁定":"Lock","解锁":"Unlock","空座位":"Empty Seat","旁观已":"Spectating","开启":"On","关闭":"Off","踢出玩家":"Kick Player","确定把":"Remove","移出房间吗？":"from the room?","已把":"Removed","移出房间":"from the room","踢出失败":"Kick failed","6 位密码（留空则取消密码）":"6-digit password (leave blank to remove)","密码已更新":"Password updated","已取消密码":"Password removed","房间密码已更新":"Room password updated","已取消房间密码":"Room password removed","最小买入（BB）":"Min Buy-in (BB)","请输入 BB 数":"Please enter the number of BBs","最小买入已设为":"Min buy-in set to","已将房主转让给":"Host transferred to","转让失败":"Transfer failed","解散后房间号立即失效，座位上的所有人都会被移出，确定吗？":"The room No. becomes invalid immediately and everyone seated is removed. Are you sure?","解散":"Dissolve","这是随机分配的牌桌，无需解散，直接离开即可":"This is a randomly assigned table, no need to dissolve it — just leave","解散失败":"Failed to dissolve","房间已解散":"Room dissolved","已批准入座":"Seat approved","座位":"Seat","请先点底部「入座玩牌」，买入后才能换座位":"Please tap \"Take a Seat\" at the bottom and buy in before changing seats","本手结束后自动换到座位":"Seat change applies after this hand","座位已锁定":"Seat locked","当前没有手牌":"No hand in progress","人声播报（过牌/弃牌/跟注/加注/全下）":"Voice announcements (check/fold/call/raise/all-in)","显示成手提示":"Show made-hand hints","显示底池赔率":"Show pot odds","隐藏聊天":"Hide chat","green|经典绿":"green|Classic Green","blue|深海蓝":"blue|Deep Blue","red|酒红":"red|Wine Red","red|经典红":"red|Classic Red","blue|宝石蓝":"blue|Sapphire Blue","gold|黄金":"gold|Gold","牌背已切换":"Card back changed","房间已解散或你已不在房间成员里":"Room dissolved or you're no longer a member","已离开房间":"Left the room","已入座":"Seated","，下一手开始参与":", you'll play from the next hand","已离开牌桌，本金已退回":"Left the table, principal returned","，桌上净盈利":", net profit at the table","不可兑现":"not cashable","离开后将先退回桌上本金（赢来的净盈利仍留在牌桌），确定吗？":"Leaving returns your table principal first (net winnings stay on the table). Are you sure?","牌局回放 ·":"Hand Replay ·","· 底池":"· Pot","· 本局盈利 +":"· Profit this hand +","· 本局亏损":"· Loss this hand","回顾":"Review","买入":"Buy-in","空位":"Empty","未入座":"Not seated","下手上桌":"Play next hand","底池 POT":"POT","入座玩牌":"Take a Seat","取消":"Cancel","All-in or Fold：本玩法只能全下或弃牌":"All-in or Fold: this variant only allows going All-in or folding","继续 ▸":"Continue ▸","点击选择要保留的 2 张牌":"Tap to select the 2 cards to keep","对手":"Opponent","获胜概率":"Win Probability","补牌数 OUTS":"Outs","最高赔付":"Max Payout","保费":"Premium","若本手未能赢下底池，将获得最高":"If you don't win the pot you receive up to","赔付；若获胜，仅扣除保费。":"in payout; if you win, only the premium is deducted.","保费已含 6% 手续费":"Premium includes a 6% fee","赠送金币":"Gift Coins","加为好友":"Add as Friend","扔道具":"Throw Item","买入/加码":"Buy-in/Add","站起/坐下":"Stand/Sit","亮出底牌":"Show Hole Cards","最近数据":"Recent Stats","账户余额":"Account Balance","账户里没有筹码可划入牌桌 · 先充值，买入后才能发牌下注":"No chips to move to the table · deposit first, then buy in to be dealt in and bet","去充值":"Go Deposit","稍后再说":"Later","账户筹码":"Account Chips","自动补码至 100BB":"Auto top-up to 100BB","每手结束后自动补足":"Auto top-up after each hand","确认买入":"Confirm Buy-in","快捷短语":"Quick Phrases","本手投入":"Invested This Hand","我的本桌数据":"My Stats at This Table","盈亏":"P&L","未开启":"Disabled","这一桌还没有服务端房间号":"This table has no server-side room No. yet","好友要能收到邀请、并且自己同意之后才入座，需要一个":"For friends to receive an invite and accept before being seated, you need a","真实房间":"real room","（房间号由服务端生成）。":"(the room No. is generated by the server).","创建房间并邀请":"Create Room & Invite","房主":"Host","房间管理":"Room Management","最小买入":"Min Buy-in","把房主身份交给其他玩家":"Hand host role to another player","锁定空座位":"Lock empty seats","新玩家需房主批准":"New players need host approval","好友可观看你的底牌":"Friends can watch your hole cards","座位管理（点击踢出）":"Seat Management (tap to kick)","转让":"Transfer","玩家需经房主批准或自动分配后入座":"Players are seated after host approval or auto-assignment","批准":"Approve","自动分配空位":"Auto-assign empty seats","开启后有空位时按排队顺序自动入座":"When enabled, queued players are seated automatically as seats open","我坐这里":"Sit Here","带入筹码入座":"Buy in and take a seat","邀请好友占座":"Invite Friends to Seats","锁定座位":"Lock Seat","其他玩家无法入座":"Other players cannot sit here","当前成手":"Current Made Hand","胜率（估算）":"Equity (estimated)","补牌 OUTS":"Outs","底池赔率":"Pot Odds","跟注有利可图":"Calling is profitable","跟注不划算":"Calling is not profitable","桌布颜色":"Felt Color","牌背样式":"Card Back Style","回放 ›":"Replay ›","行动记录":"Action Log","赢家":"Winner","本街无行动":"No actions this street","输入收款人 ID":"Enter recipient ID","请输入支付密码":"Please enter your payment password","已选择收款人":"Recipient selected","最少转账 1000":"Minimum transfer is 1,000","请输入 6 位支付密码":"Please enter the 6-digit payment password","转账中…":"Transferring…","转账失败，请稍后再试":"Transfer failed, please try again later","转账成功，":"Transfer successful,","对方":"recipient","已到账":"received","我的背包":"My Bag","热卖":"Hot","低于单笔最小限额":"Below the per-transaction minimum","超过单笔限额":"Exceeds the per-transaction limit","超过单日限额":"Exceeds the daily limit","USDT（今日已用":"USDT (used today","超过单月限额":"Exceeds the monthly limit","· 超限":"· over limit","请输入 USDT 金额":"Please enter a USDT amount","请输入充值金额":"Please enter a deposit amount","正在生成…":"Generating…","地址已复制":"Address copied","已记录，链上到账后会自动发放筹码":"Recorded; chips are credited automatically once it lands on-chain","提交审核":"Submit for Review","取消失败":"Cancel failed","订单已取消":"Order cancelled","收款地址二维码":"Deposit Address QR Code","转账后填写":"Fill in after transferring","分":"min","秒":"sec","充值已到账：+":"Deposit received: +","等待链上到账…（":"Waiting for on-chain confirmation… (","粘贴你的收款地址":"Paste your receiving address","可疑单会被冻结待人工复核，驳回则把 USDT 退回余额。":"Suspicious orders are frozen for manual review; if rejected, the USDT is returned to your balance.","请填写提现金额":"Please enter a withdrawal amount","超出可提现 USDT 余额，请先把筹码兑换成 USDT":"Exceeds your withdrawable USDT balance; convert chips to USDT first","提现金额需大于手续费":"Withdrawal amount must be greater than the fee","请填写收款地址":"Please enter a receiving address","提现申请已提交，等待风控审核":"Withdrawal submitted, awaiting risk review","筹码 ·":"chips ·","筹码为牌桌盈利，只能继续游戏，不能兑换提现。":"These chips are table winnings: they can only be used to keep playing and can't be converted or withdrawn.","在「提现」里填金额提交即可（单笔固定手续费":"Enter an amount under \"Withdraw\" and submit (flat per-transaction fee of","USDT，提现不限额度）。":"USDT, no withdrawal cap).","兑换（筹码 → USDT）":"Convert (chips → USDT)","⚠ 超出可兑换额度":"⚠ Exceeds the convertible amount","请填写兑换筹码":"Please enter the chips to convert","超出可兑换额度":"Exceeds the convertible amount","兑换中…":"Converting…","兑换失败":"Conversion failed","已兑换":"Converted","USDT（免费）":"USDT (free)","选择收款人":"Select Recipient","玩家 ID":"Player ID","转账金额":"Transfer Amount","备注（选填）":"Note (optional)","支付密码（6 位）":"Payment Password (6 digits)","未设置支付密码，先到「我的 → 安全中心 → 支付密码」设置":"No payment password set; go to \"Me → Security Center → Payment Password\" first","免费":"Free","当日剩余额度":"Remaining daily limit","200 万":"2,000,000","★ 只能转给已互加的好友；转账是即时到账，对方可在「邮件」里看到通知":"★ Transfers go only to mutual friends and arrive instantly; the recipient sees a notice in \"Mail\"","查看转账记录 ›":"View Transfer History ›","使用":"Use","赠送":"Gift","背包空空如也":"Your bag is empty","暂无转账记录":"No transfer records","需先完成实名认证":"ID verification required first","一键":"One-tap","充值功能已关闭":"Deposit is currently disabled","充值已到账":"Deposit received","审核通过后仍需「确认到账」才会增加筹码 —— 人工审核与链上到账是两件事。":"Even after approval you must confirm receipt before chips are added — manual review and on-chain arrival are two separate things.","当前筹码":"Current Chips","充值金额（USDT）":"Deposit Amount (USDT)","确认后直接显示平台收款地址和二维码，链上到账自动入账（通常 1~3 分钟）。":"After confirming, the platform deposit address and QR code are shown; on-chain arrival is credited automatically (usually 1-3 minutes).","收款地址待配置":"Deposit address not configured yet","收款地址待运营方配置":"Deposit address pending operator configuration","请向下方地址转入":"Please send to the address below","金额必须完全一致":"The amount must match exactly","，少转会导致无法自动到账":"; sending less means it can't be credited automatically","订单有效期":"Order validity","，超时未到账请联系客服补单":"; if it doesn't arrive in time, contact support to file a claim","复制地址":"Copy Address","（必填）":"(required)","等待链上到账…":"Waiting for on-chain confirmation…","交易哈希 TXID（可选，方便对账）":"TXID (optional, easier to reconcile)","我已转账":"I've Sent It","取消该订单":"Cancel This Order","还没有订单":"No orders yet","提现功能已关闭":"Withdrawal is currently disabled","可提现 USDT 余额":"Withdrawable USDT Balance","提现金额（USDT）":"Withdrawal Amount (USDT)","提现金额":"Withdrawal Amount","单笔手续费（固定）":"Per-Transaction Fee (flat)","提现审批流":"Withdrawal Approval Flow","兑换功能已关闭":"Conversion is currently disabled","可兑换额度（仅充值本金与后台发放）":"Convertible Amount (deposit principal and admin grants only)","兑换筹码":"Chips to Convert","兑换汇率":"Exchange Rate","1 USDT =":"1 USDT =","到账 USDT":"USDT Received","兑换后怎么提现":"How to withdraw after converting","确认兑换":"Confirm Conversion","去提现":"Go Withdraw","条":"","邀请失败（":"Invite failed (","（手续费":"(fee","· 私人房":"· Private Room","（带入":"(bringing","已入座 · 等这一局打完，下一手就发牌给你":"Seated · you'll be dealt in after this hand","请输入收款人 ID":"Please enter recipient ID","0 USDT（免费）":"0 USDT (free)","底池":"Pot","桌":"table","人桌":"-max","加入":"join","手":"hand","张":"cards","次":"times","局":"hands","强度":"strength","已":"","德州":"Hold'em","单挑":"Heads-Up","菠萝":"Pineapple","级别":"Stakes","微额":"Micro","小额":"Small","中额":"Mid","高额":"High","盲注":"Blinds","金币":"Coins","币":"coin","已打手数":"Hands played","本平台以 USDT 为唯一计价币种：充值到账、牌桌输赢、提现出款都是同一笔 USDT 余额，":"One single USDT balance covers everything: deposits, table play and withdrawals all use the same balance,","没有任何USDT中间环节，也不需要兑换。提现单笔固定手续费 2 USDT，不限额度，走风控审核。":"and USDT is never converted in between. Each withdrawal has a fixed 2 USDT fee, no limits, subject to risk review.","如何购买保险？":"How do I buy Insurance?","All-in 时系统会自动弹出保险窗口，点击立即投保即可。":"When you go All-in, the Insurance window pops up automatically — just tap to insure.","为什么我无法转账？":"Why can't I transfer?","需设置支付密码，且当日转账额度未超限。":"A payment password must be set, and the daily transfer limit must not be exceeded.","怎么充值、怎么提现？":"How to deposit and withdraw?","充值：用 USDT 直接充值，审核到账后进入余额。提现：余额里的 USDT 可直接申请提现，单笔固定手续费 2 USDT，不限额度，走风控审核。全程没有「USDT」这一层。":"Deposit: send USDT directly; it lands in your balance after review. Withdraw: apply with your USDT balance — fixed 2 USDT fee per withdrawal, no limits, subject to risk review.","VPIP 是什么意思？":"What does VPIP mean?","VPIP 表示主动入池率，是重要的扑克数据指标。":"VPIP (voluntarily put in pot) is a key poker statistic.","净盈利":"Net profit","赢下底池":"Pots won","累计充值":"Total deposits","距离":"to reach","还需":"need","已打 ":"Played "," 手 · 赢池 ":" hands · won "," 个":" pots","已连续签到 ":"Checked in for "," 天":" days","连续签到累计可领 ":"Sign in daily to earn up to "," 手":"hands","打 hand 数":"Hands played","GU9扑克":"GU9 Poker","返回":"Back","正在连接牌桌…":"Connecting to the table…","还没有消息，来说点什么":"No messages yet — say something","扔个道具":"Throw an item","房间":"Room","挑好友发邀请，他同意后才入座":"Pick a friend and send an invite — they take a seat after accepting","发给好友，他在大厅搜索就能进":"Send it to a friend; they can search it in the lobby to enter","本手牌面与动作记录":"This hand's board and action log","桌上余额（含盈利）全额退回账户":"Your full table balance (including profit) is returned to your account","余额":"Balance","最小":"Min","最大":"Max","半数":"Half","买入并加入牌桌":"Buy in and join the table","好友点「同意」后才会入座；他也可以直接在大厅用房间号":"They take a seat only after tapping Agree; they can also enter from the lobby with the room number","搜索进入。":"to search and enter.","刷新好友":"Refresh friends","正在加载好友…":"Loading friends…","旁观":"Spectating","桌上余额":"Table balance","等待好友入座":"Waiting for friends to take a seat","等待好友入座 · 房间号":"Waiting for friends · Room","本手结束，即将开始下一手…":"Hand over, next one starting…","这一手开始时你还没上桌 · 下一手自动给你发牌":"You were not seated when this hand started · you'll be dealt in automatically next hand","行动…":"to act…","等待对手行动…":"Waiting for opponents to act…","补充买入":"Add chips","加码":"Add chips","桌上余额为 0 · 补充买入后才会发牌":"Table balance is 0 · add chips to be dealt in","账户余额为 0 · 请先充值再买入上桌":"Account balance is 0 · deposit first, then buy in","筹码不足最小加注，只能跟注或全下":"Not enough chips for a min-raise — call or go all-in only","这个房间已被房主解散或已过期。":"This room was closed by the host or has expired.","桌上没有你的筹码，余额都在账户里，放心返回大厅。":"You have no chips on the table — your balance is safe in your account, just head back to the lobby.","USDT 余额不足，无法买入（至少需要":"Not enough USDT to buy in (minimum","范围":"Range","成功":"successful","你不在该房间，请先在大厅加入房间":"You are not in this room — please join it from the lobby first","买入失败(":"Buy-in failed (","退出牌桌将把桌上余额（USDT，含盈利）全额退回账户，确定离开房间吗？":"Leaving returns your full table balance (USDT, including profit) to your account. Leave the room?","发送失败":"Failed to send","扔给":"Throw to","扔得太快了，歇一下":"Throwing too fast — take a break","道具发送失败":"Failed to throw the item","不能给自己扔道具":"You can't throw an item at yourself","买入入座后才能扔道具":"Buy in and take a seat before throwing items","本手未参与（等待下一手发牌）":"Not in this hand (waiting for the next deal)","公牌":"Board","还未翻牌":"No flop yet","动作记录":"Action log","本手还没有动作记录":"No actions yet in this hand","（请手动复制）":"(please copy manually)","没有房间号":"No room number","你还没有好友。把房间号":"You have no friends yet. Send the room number","发给朋友，让他在大厅搜索进入。":"to a friend so they can search for it and enter from the lobby.","邀请":"Invite","，等对方同意后入座":", they take a seat after accepting","邀请失败(":"Invite failed (","缺少房间号":"Missing room number","未登录，请先回到 App 登录":"Not logged in — please go back to the app and log in","缺人，来":"short-handed, need","已经添加到主屏幕":"Already added to the home screen","已添加到主屏幕":"Added to the home screen","已取消添加":"Adding cancelled","添加到主屏幕":"Add to Home Screen","在浏览器里安装 GU9 德州扑克":"Install GU9 Poker in the browser","① 点浏览器右上角的 ⋮ 菜单（或地址栏右侧的安装图标）":"① Tap the ⋮ menu at the top right of the browser (or the install icon in the address bar)","⋮ 菜单":"⋮ menu","（或地址栏右侧的安装图标）":"(or the install icon on the right of the address bar)","② 选择 「安装应用」/「添加到主屏幕」":"② Choose \"Install app\" / \"Add to Home Screen\"","「安装应用」/「添加到主屏幕」":"\"Install app\" / \"Add to Home Screen\"","③ 点 安装 完成":"③ Tap Install to finish","安装":"Install","若该菜单项未出现，请确认用 Chrome 打开且已联网。":"If that menu item doesn't appear, make sure you opened this in Chrome and are online.","把 GU9 德州扑克放到手机桌面":"Put GU9 Poker on your home screen","① 点此分享":"① Tap Share here","分享菜单":"Share menu","② 添加到主屏幕":"② Add to Home Screen","③ 点右上角「添加」即可":"③ Just tap \"Add\" at the top right","添加后手机桌面会出现 GU9 图标，下次直接点开就是全屏 App。":"Once added, the GU9 icon appears on your home screen — tap it to open the full-screen app.","（iOS 系统限制：此步骤需手动操作，无法一键自动）":"(iOS limitation: this step must be done manually)","小王子":"Prince","收割机":"Harvester","USDT收割机":"USDT Harvester","页面出错":"Page error","这个页面开小差了":"This page slipped up","返回上一页":"Go back","页面加载出错，请返回重试":"Page failed to load — please go back and try again","每位玩家 2 张底牌 + 5 张公共牌，任选组合成最大 5 张牌型。可任意加注，最大可 All-in 全部余额。":"Each player gets 2 hole cards plus 5 community cards and makes the best 5-card hand. Bet any amount, up to All-in for your whole stack.","新手首选。位置、起手牌范围与余额管理是最重要的三项基本功。":"Best for beginners. Position, starting-hand range and bankroll management are the three fundamentals.","每位玩家 4 张底牌，必须「恰好使用 2 张底牌 + 3 张公共牌」组成牌型。最大只能下注一个底池。":"Each player gets 4 hole cards and must use exactly 2 hole cards + 3 community cards. The max bet is one pot.","5 张底牌版本的奥马哈，同样必须用恰好 2 张底牌 + 3 张公共牌，牌力天花板更高、波动更大。":"A five-card Omaha variant: again exactly 2 hole cards + 3 community cards, with bigger nut hands and bigger swings.","4 张底牌奥马哈，底池由「最大牌型」与「8 低及以下的低牌」平分；无合格低牌时高牌全收。":"Four-card Omaha: the pot is split between the best high hand and the 8-or-better low hand; with no qualifying low, the high hand scoops.","去掉 2~5 只保留 6~A 共 36 张牌，成牌概率大幅提升。特殊规则：同花 > 葫芦":"2 to 5 are removed, leaving 36 cards (6–A), so made hands are far more common. Special rule: flush beats full house","A 可作 5 参与顺子（6-7-8-9-A）。":"A can play as 5 in a straight (6-7-8-9-A).","牌型顺序特殊：同花 > 葫芦":"Special hand ranking: flush beats full house","单桌赛":"Sit & Go","盲注逐级上涨，余额不能带出牌桌":"Blinds rise level by level and stacks cannot be cashed out mid-game","随机奖池":"Random Prize Pool","3 人超快速锦标赛，开赛前随机抽取奖池倍率（2x ~ 数万倍），一手定胜负节奏极快。":"A 3-player hyper-turbo: the prize multiplier (2x up to tens of thousands) is drawn before the first hand — lightning fast, decided in an instant.","初始余额通常为 25~50BB，盲注快速上涨":"Starting stacks are usually 25–50BB with fast-rising blinds","浅余额对抗，熟记推牌/跟注范围表是关键。":"Short-stack play — memorising push/fold charts is the key.","上限":"Cap","请输入房间口令":"Please enter the room passcode","请刷新页面后重试":"Please refresh the page and try again","正在进入机器人房…":"Entering the bot room…","进入机器人房失败，请重试":"Failed to enter the bot room, please try again","每晚 20:00 · 保底奖励 5,000 USDT":"Every night at 20:00 · 5,000 USDT guaranteed prize pool","登录 7 天领 1,000 USDT":"Log in for 7 days and claim 1,000 USDT","房间号搜索":"Room number search","满员":"Full","皇家同花顺俱乐部|128 成员|今日盈利 328万":"Royal Flush Club|128 members|3.28M profit today","深夜牌神联盟|64 成员|今日盈利 96万":"Midnight Poker Gods|64 members|960K profit today","概率信徒|32 成员|今日盈利 12万":"Believers in Probability|32 members|120K profit today","开赛":"starts","保底":"Guaranteed","邀请赛":"Invitational","手 · 赢池":"hands · pots won","种主流玩法规则":"popular game rules","未绑定手机 · 建议绑定":"No phone number bound · binding recommended","像 App 一样从桌面打开":"Open from your home screen like an app","· 注册":"· joined","我的余额":"My balance","可提现":"Withdrawable","好友打开下方链接注册时，推荐人 ID 会自动填好":"When a friend registers through the link below, the referrer ID is filled in automatically","复制邀请链接":"Copy invite link","1. 好友通过你的邀请链接进入，注册页「推荐人 ID」已自动填入；":"1. When a friend signs up through your invite link, the referrer ID is already filled in on the signup page;","2. 好友首次充值到账后，奖励自动进你的 USDT 余额（后台可查流水，类型 invite）；":"2. After your friend's first deposit clears, the reward is credited to your USDT balance (visible in the admin ledger, type invite);","邀请链接已复制":"Invite link copied","USDT 余额":"USDT balance","账户与牌桌统一以 USDT 计价 · 可直接上桌或提现":"Account and tables are both denominated in USDT · play at the tables or withdraw directly","转出 ·":"Transfer out ·","转入 ·":"Transfer in ·","转出":"Transfer out","转入":"Transfer in","已连续签到":"Checked in","连续签到累计可领":"Sign in on consecutive days to earn up to","第 1 天领 1 USDT，第 2 天 2 USDT，以此类推，第 7 天 7 USDT。":"Day 1 gets you 1 USDT, day 2 gets 2 USDT, and so on up to 7 USDT on day 7.","中途断签会重新从第 1 天开始。签到所得为真实 USDT，可直接上桌或提现。":"Missing a day resets the streak to day 1. Check-in rewards are real USDT — play with them or withdraw them.","任务奖励已下线":"Task rewards discontinued","一键领取全部附件（":"Claim all attachments (","来自":"From","钻石":"Diamonds","本平台提供的德州扑克游戏，全部以 USDT 计价与结算：充值、牌桌下注、提现均为同一笔 USDT 余额，":"All Texas Hold'em games on this platform are denominated and settled in USDT: deposits, table bets and withdrawals all use the same USDT balance,","不含任何虚拟USDT或中间兑换环节。":"with no virtual currency and no intermediate conversion.","2. 一个自然人仅限持有并使用一个账号；同一设备、同一 IP 批量注册将被风控识别并处置。":"2. One individual may hold and use only one account; bulk registration from the same device or IP will be flagged and handled by risk control.","1. 余额来源：USDT 充值、签到与活动发放、牌桌输赢、后台发放。":"1. Balance sources: USDT deposits, check-in and event rewards, table results and admin grants.","2. 提现：账户 USDT 余额（含牌桌盈利）均可申请提现，按平台公示规则收取单笔固定手续费。":"2. Withdrawals: any USDT balance (including table profit) can be withdrawn, with a fixed per-transaction fee as published by the platform.","3. 提现需通过实名认证与风控审核；异常余额跳变将被标记并可能暂缓出款。":"3. Withdrawals require identity verification and risk review; abnormal balance jumps will be flagged and payouts may be delayed.","4. 平台不生成、不托管任何资金地址；充值地址与出款由持牌运营方的支付服务商完成。":"4. The platform neither generates nor custodies any fund addresses; deposit addresses and payouts are handled by the licensed operator's payment provider.","发布违法违规信息；冒充平台工作人员。一经核实，平台有权冻结账号、清零违规所得并永久封禁。":"Posting illegal content or impersonating platform staff. Once verified, the platform may freeze the account, confiscate illicit gains and ban it permanently.","1. 注册信息：账号、昵称、加密后的登录密码（我们只保存不可逆的加盐哈希，不保存明文）。":"1. Registration data: account, nickname and encrypted password (we store only an irreversible salted hash, never the plaintext).","2. 必要的业务信息：充值 / 提现订单记录、设备与 IP 日志（用于风控与找回事宜）。":"2. Necessary business data: deposit / withdrawal records and device & IP logs (for risk control and account recovery).","3. 游戏数据：牌局记录、USDT 资金流水，用于提供服务、处理争议与反作弊。":"3. Game data: hand history and USDT transaction records, used to deliver the service, resolve disputes and fight cheating.","我们不会出售你的个人信息。仅在下列情形共享：为完成支付与出款，向持牌支付服务商提供必要信息；":"We never sell your personal information. It is shared only in these cases: with the licensed payment provider to complete payments and payouts;","未绑定":"Not bound","支付密码转账时使用":"Payment password, used for transfers","未设置":"Not set","台设备":"devices","充值：用 USDT 直接充值，审核到账后进入余额。":"Deposit: send USDT directly — it lands in your balance after review.","提现：余额里的 USDT 可直接申请提现，单笔固定手续费 2 USDT，不限额度，走风控审核。":"Withdraw: apply with the USDT in your balance — fixed 2 USDT fee per withdrawal, no limits, subject to risk review.","全程没有「USDT」这一层。":"There is no intermediate points layer at any stage.","联系在线客服":"Contact online support","已接入第三方客服系统，点击将打开客服对话窗口":"A third-party support system is connected — tap to open the chat window","客服系统暂未配置":"Support system not configured yet","游戏目标：用 2 张底牌与 5 张公共牌组成最大的 5 张牌型，赢取底池。":"Objective: use 2 hole cards and 5 community cards to make the best 5-card hand and win the pot.","保险：All-in 时可按实时胜率购买 EV 保险，未赢下底池则获赔付。":"Insurance: on All-in you can buy EV insurance at live odds; if you don't win the pot, you get paid out.","支持 PNG / JPG / WEBP，自动压缩到 256×256，单张 ≤ 2MB":"PNG / JPG / WEBP supported, auto-compressed to 256×256, max 2MB per image","图片读取失败":"Failed to read the image","保密":"Prefer not to say","种主流玩法":"popular variants","必须用【恰好 2 张底牌 + 3 张公共牌】：A♠K♠ + 9♠2♠7♦ 组成同花 A♠K♠9♠2♠ + 7♦（A 高同花）。":"You must use exactly 2 hole cards + 3 community cards: A♠K♠ + 9♠2♠7♦ makes the flush A♠K♠9♠2♠ + 7♦ (A-high flush).","同花 > 葫芦：A♥9♥8♥7♥6♥ 为同花顺；":"Flush beats full house: A♥9♥8♥7♥6♥ is a straight flush;","A-6-7-8-9 在短牌中是有效顺子（A 作低牌）。":"A-6-7-8-9 is a valid straight in short deck (A plays low).","底牌 A♠2♠K♦Q♦ + 公共牌 3♥5♣8♦9♥J♣ → 低牌 A-2-3-5-8 成立，可争一半底池；":"Hole cards A♠2♠K♦Q♦ + board 3♥5♣8♦9♥J♣ → the low A-2-3-5-8 qualifies for half the pot;","高牌若有 K 或 Q 对子可争另一半。":"A high hand with a pair of K or Q can take the other half.","最多":"Max","仅在翻牌后收取，翻牌前结束不抽水（No Flop No Drop）。":"Charged only after the flop; hands that end pre-flop are not raked (No Flop No Drop).","从报名费中扣除，奖池为扣除服务费后的部分。":"Deducted from the buy-in; the prize pool is what remains after the service fee.","平台从每个底池收取的服务费，只在翻牌发出后产生；":"The platform's service fee is taken from each pot, and only once the flop is dealt;","翻牌前结束的手牌不抽水（No Flop No Drop）。":"Hands ending before the flop are not raked (No Flop No Drop).","每手按贡献抽水返还":"Rake returned every hand based on your contribution","无返水（VIP5 起享返水）":"No rakeback (available from VIP5)","返水":"Rakeback","每手结算后按 VIP 等级即时返还到余额账户。":"Credited to your balance instantly after each hand, based on your VIP level.","公开房间":"Public room","开启后大厅所有人可见并可进入（设了密码仍需输入）":"When enabled, everyone in the lobby can see and enter the room (a password is still required if set)","位好友（离线好友会发送邀请通知）":"friends selected (offline friends receive an invite notification)","条邀请，好友在「好友 → 房间邀请」里同意后才会入座。没同意之前，谁也不会被拉进来。":"invites sent; friends take a seat only after accepting under Friends → Room Invites. Nobody is pulled in before they accept.","条邀请，好友在「好友 → 房间邀请」里同意后才会入座。":"invites sent; friends take a seat only after accepting under Friends → Room Invites.","炸弹":"Bomb","轰一下":"Boom","臭鸡蛋":"Rotten Egg","啪唧糊上去":"Splat","捏鸡脖子":"Choke the Chicken","一顿惨叫":"Awful Scream","飞鞋子":"Flying Shoe","啪的一声拍脸":"Slap in the Face","蛋糕砸脸":"Cake in the Face","奶油糊一脸":"Cream All Over","番茄":"Tomato","汁水四溅":"Juicy Splatter","扔了":"threw","一起打牌吗？":"Want to play a hand together?","在哪个房间？":"Which room?","借我点余额":"Lend me some balance","我的余额：":"My balance:","邀请你进入房间":"invites you to a room","邀请你 · 房间":"invites you · Room","赠送余额":"Gift balance","· 已投保":"· insured","买入才能入局":"Buy in to join the game","牌桌余额为 0 · 点「买入」把余额（":"Table balance is 0 · tap Buy-in to move your balance (","U）划到桌上才会发牌、才能下注":"U) onto the table before you are dealt in or can bet","· 底池限注最大":"· pot-limit max","确认加注":"Confirm raise","本手已结束 ·":"Hand over ·","秒后自动开始下一局":"s until the next hand starts automatically","决策超时！再不操作将在":"Decision timed out! Act now or in","秒后被弃牌并请出房间":"s you'll be auto-folded and removed from the room","超时未操作，已自动弃牌并离开房间":"No action in time — auto-folded and removed from the room","牌桌余额已输光，请先买入":"Your table stack is gone — please buy in first","余额不足，无法投保":"Not enough balance to buy insurance","· 本手投入":"· invested this hand","牌桌余额":"Table balance","练习币已补充，可继续练习 · 真钱对局请到大厅开房与好友对战":"Chips topped up, keep practising · for real money, open a room in the lobby and play with friends","练习币":"Practice chips","桌上可取回本金":"Withdrawable principal on the table","（赢来的净盈利不可取出）":"(net profit won cannot be withdrawn)","取回本金":"Withdraw principal","当前余额已足够":"Your current balance is already enough","练习币不足":"Not enough practice chips","桌上没有本金可取":"There is no principal on the table to withdraw","当牌局中出现 All-in 时，系统会根据你的补牌数（Outs）实时计算获胜概率，并提供保险报价。":"When an All-in occurs, the system calculates your live win probability from your outs and offers an insurance quote.","获胜概率 = 1 - (未中补牌概率)":"Win probability = 1 − (probability of missing your outs)","本桌保险状态：":"Insurance status at this table:","牌桌未就绪":"Table not ready","给这张桌子建一个真实房间":"Create a real room for this table","好友要能收到邀请、并且自己同意之后才入座，需要一个真实房间":"For friends to receive an invite and take a seat after accepting, a real room is needed","按本桌参数创建：":"Create with this table's settings:","的房":"'s room","创建房间失败，请重试":"Failed to create the room, please try again","房间已创建":"Room created","房间号（好友在大厅搜这个号就能进）":"Room number (friends can search this number in the lobby to enter)","好友也可以凭这个房间号在大厅顶部搜索框直接找到房间。":"Friends can also find the room directly with this number in the lobby search box.","要跟好友同桌打，你自己也要进这个房间（点下面第一个按钮）。":"To play at the same table as your friends, you must enter this room too (tap the first button below).","先邀请好友":"Invite friends first","留在本桌继续玩机器人":"Stay at this table and keep playing the bots","已保留，随时可从大厅进入":"Saved — you can enter from the lobby any time","排队":"Queue","位 · 等待":"· waiting","买入后入座":"Buy in to take a seat","当前无需跟注":"No call required right now","经典绿":"Classic Green","深海蓝":"Deep Blue","酒红":"Wine Red","经典红":"Classic Red","宝石蓝":"Sapphire Blue","黄金":"Gold","· 投入":"· invested","可用":"Available","★ 只能转给已互加的好友；":"★ You can only transfer to mutual friends;","转账是即时到账，对方可在「邮件」里看到通知":"transfers arrive instantly and the recipient sees a notification under Mail","请输入转账金额":"Please enter the transfer amount","最少转账 0.01 USDT":"The minimum transfer is 0.01 USDT","转出给":"Transfer to","收到来自":"Received from","KYC 未通过前，充值 / 提现功能不可用。请联系客服完成实名核验，":"Deposits and withdrawals are unavailable until KYC passes. Please contact support to complete identity verification,","或由运营方在后台「用户管理 › 编辑」中标记实名通过。":"or have the operator mark KYC as passed under Admin › Users › Edit.","快捷充值":"Quick deposit","点一下直接生成订单 ·":"One tap creates the order ·","· 充值到账即为 USDT 余额":"· deposits land directly as USDT balance","订单":"Order","审核通过后仍需「确认到账」才会增加 USDT 余额 —— 人工审核与链上到账是两件事。":"Even after approval it needs on-chain confirmation before your USDT balance increases — manual review and on-chain arrival are two separate things.","当前余额":"Current balance","单笔":"Per transaction","链上自动收款":"Automatic on-chain collection","平台收款地址尚未配置，暂时无法充值；":"The platform deposit address is not configured yet, so deposits are unavailable;","配置完成后这里会显示「链上自动收款」。":"once configured, \"Automatic on-chain collection\" will show here.","如有疑问请联系客服。":"Contact support if you have any questions.","已记录，链上到账后会自动充入 USDT 余额":"Recorded — once it arrives on chain it will be credited to your USDT balance automatically","支付通道未接入。":"Payment channel not connected.","订单已生成并进入「待审核」。":"Order created and now pending review.","运营方在后台「USDT 收款」页添加收款地址后，本页会自动显示地址。":"Once the operator adds a receiving address under Admin › USDT Deposit, it will appear here automatically.","金额必须完全一致，少转会导致无法自动到账":"the amount must match exactly — sending less means it cannot be credited automatically","收款地址（":"Receiving address (","达到确认数后系统自动到账，无需联系客服。":"Funds are credited automatically once the required confirmations are reached — no need to contact support.","请先登录":"Please log in first","账户余额即 USDT，充值到账与牌桌盈利都可提现":"Your account balance is USDT; both deposits and table profit can be withdrawn","提现不限额度 · 单笔手续费固定":"No withdrawal limit · fixed fee per withdrawal","提交后提现金额立即从 USDT 余额冻结；":"Once submitted, the withdrawal amount is frozen from your USDT balance immediately;","风控审核通过后系统自动发起":"after risk review the system automatically initiates","链上出款，":"an on-chain payout,","链上自动出款":"Automatic on-chain payout","到账后可在「我的订单」查看交易哈希。可疑单会被冻结待人工复核，驳回则把 USDT 退回余额。":"Check the transaction hash under My Orders once it arrives. Suspicious orders are frozen for manual review; rejected ones return the USDT to your balance.","超出可提现 USDT 余额":"Exceeds your withdrawable USDT balance","提现申请已提交，审核通过后自动链上出款":"Withdrawal submitted — it will be paid out on chain automatically after review","葫芦：A♥9♥8♥7♥6♥ 为同花顺；A-6-7-8-9 在短牌中是有效顺子（A 作低牌）。":"Full house: A♥9♥8♥7♥6♥ is a straight flush; A-6-7-8-9 is a valid straight in short deck (A plays low).","已发出":"Sent","已发出 ":"Sent ","注册 ":"member for ","牌桌余额为 0 · 点「买入」把练习币余额（":"Table balance is 0 · tap Buy-in to move your practice chip balance (","保费 = 最高赔付 × (1 - 获胜概率) × 1.06（含 6% 手续费）":"Premium = max payout × (1 − win probability) × 1.06 (includes a 6% fee)","· 手续费":"· fee","或由运营方在后台「用户管理 &rsaquo; 编辑」中标记实名通过。":"or have the operator mark KYC as passed under Admin › Users › Edit.","&middot; 充值到账即为 USDT 余额":"· deposits land directly as USDT balance","提现不限额度 &middot; 单笔手续费固定":"No withdrawal limit · fixed fee per withdrawal","扔給":"Throw to","道具發送失敗":"Failed to throw the item","不能給自己扔道具":"You can't throw an item at yourself","買入入座後才能扔道具":"Buy in and take a seat before throwing items","炸彈":"Bomb","轟一下":"Boom","臭雞蛋":"Rotten Egg","捏雞脖子":"Choke the Chicken","一頓慘叫":"Awful Scream","飛鞋子":"Flying Shoe","啪的一聲拍臉":"Slap in the Face","蛋糕砸臉":"Cake in the Face","奶油糊一臉":"Cream All Over","汁水四濺":"Juicy Splatter","赢":"Won","输":"Lost","共 ":"Total","每位":"Each","任选组合成":"combine into the best","牌型":"hand","可任意":"Any","最大可":"up to","张底牌":"cards hole cards","All-in 全部余额":"All-in your whole stack","手牌 #":"Hand #","限注":"Limit","注额":"Bet size"};
  var TW = {"注册并登录":"註冊並登錄","② 注册时填写的手机号（含区号）":"② 註冊時填寫的手機號（含區號）","③ 大概的注册时间":"③ 大概的註冊時間","复制失败，请长按手动复制":"複製失敗，請長按手動複製","房间号已复制：":"房間號已複製：","复制房间号":"複製房間號","ID 已复制":"ID 已複製","分钟前":"分鐘前","同花顺制造机":"同花順製造機","河牌奇迹":"河牌奇蹟","10 月 2 日 03:00-05:00 进行服务器维护，期间无法登录。":"10 月 2 日 03:00-05:00 進行伺服器維護，期間無法登錄。","干杯！":"乾杯！","四轮下注：翻牌前 / 翻牌 / 转牌 / 河牌":"四輪下註：翻牌前 / 翻牌 / 轉牌 / 河牌","盲注：小盲 / 大盲，可开强抓 Straddle 与前注 Ante":"盲註：小盲 / 大盲，可開強抓 Straddle 與前注 Ante","低牌：5 张牌点数均 ≤ 8 且互不重复（A 算 1）":"低牌：5 張牌點數均 ≤ 8 且互不重複（A 算 1）","起手牌范围大幅放宽，中等对子价值提升，注意同花与葫芦的大小关系反转。":"起手牌範圍大幅放寬，中等對子價值提升，注意同花與葫蘆的大小關係反轉。","多桌同时进行的大型锦标赛，设有保底奖池，逐桌合并直至决赛桌。":"多桌同時進行的大型錦標賽，設有保底獎池，逐桌合併直至決賽桌。","盲注等级每 8~15 分钟上涨":"盲注等級每 8~15 分鐘上漲","牌桌已刷新（未连上服务器）":"牌桌已刷新（未連上伺服器）","服务器不可用，已进入离线模式":"伺服器不可用，已進入離線模式","注册新账号":"註冊新帳號","注册中…":"註冊中…","注册成功，请先充值再上桌":"註冊成功，請先充值再上桌","服务器不可用，已用本机账号进入":"伺服器不可用，已用本機帳號進入","注册失败（":"註冊失敗（","请提供以下信息联系在线客服人工找回：":"請提供以下信息聯繫在線客服人工找回：","服务器：亚洲一区 · 流畅":"伺服器：亞洲一區 · 流暢","立即注册":"立即註冊","1. 好友在注册页「推荐人 ID」填你的邀请码；":"1. 好友在註冊頁「推薦人 ID」填你的邀請碼；","邀请码已复制":"邀請碼已複製","1. 注册用户须年满 18 周岁，并保证注册信息真实、准确。":"1. 註冊用戶須年滿 18 周歲，並保證註冊信息真實、準確。","提供服务与客服支持；风险控制（识别异常登录、批量注册、套利行为）；":"提供服務與客服支持；風險控制（識別異常登錄、批量註冊、套利行為）；","所有后台操作写入审计日志；数据每日本地备份。":"所有後臺操作寫入審計日誌；數據每日本地備份。","登录日志（演示）":"登錄日誌（演示）","将清除本地图片与日志缓存。":"將清除本地圖片與日誌緩存。","好友注册时把「推荐人 ID」填成这串数字即可":"好友註冊時把「推薦人 ID」填成這串數字即可","复制邀请码":"複製邀請碼","最后更新：2026-10-02 · 如有疑问请通过「我的 → 客服工单」联系":"最後更新：2026-10-02 · 如有疑問請通過「我的 → 客服工單」聯繫","登录日志":"登錄日誌","有，按大盲倍数封顶，级别越高上限越宽松。":"有，按大盲倍數封頂，級別越高上限越寬鬆。","边池会重复抽水吗？":"邊池會重複抽水嗎？","常规抽水表":"常規抽水錶","复制":"複製","复制 ID":"複製 ID","已批准入座":"已批准入座","新玩家需房主批准":"新玩家需房主批准","玩家需经房主批准或自动分配后入座":"玩家需經房主批准或自動分配後入座","批准":"批准","跟注不划算":"跟注不划算","地址已复制":"地址已複製","可疑单会被冻结待人工复核，驳回则把 USDT 退回余额。":"可疑單會被凍結待人工覆核，駁回則把 USDT 退回餘額。","备注（选填）":"備註（選填）","确认后直接显示平台收款地址和二维码，链上到账自动入账（通常 1~3 分钟）。":"確認後直接顯示平臺收款地址和二維碼，鏈上到帳自動入帳（通常 1~3 分鐘）。","，超时未到账请联系客服补单":"，超時未到帳請聯繫客服補單","复制地址":"複製地址","设置":"設定","信息":"資訊","视频":"視頻","软件":"軟體","服务器":"伺服器","内存":"記憶體","芯片":"晶片","屏幕":"螢幕","按钮":"按鈕","账号":"帳號","头像":"頭像","消息":"訊息","昵称":"暱稱","界面":"介面","游客":"遊客","余额":"餘額","二维码":"QR Code","网络":"網路","签到":"簽到","点击":"點擊","数据":"數據","支持":"支援","默认":"預設","缓存":"快取","粘贴":"貼上","实名":"實名","登录":"登入","注册":"註冊"};
  var TWCHAR = {"万":"萬","与":"與","专":"專","业":"業","丢":"丟","两":"兩","严":"嚴","个":"個","为":"為","举":"舉","么":"麼","义":"義","乐":"樂","买":"買","争":"爭","于":"於","亏":"虧","亚":"亞","产":"產","亿":"億","仅":"僅","从":"從","们":"們","价":"價","优":"優","会":"會","传":"傳","体":"體","余":"餘","偿":"償","储":"儲","兑":"兌","关":"關","内":"內","册":"冊","写":"寫","军":"軍","冲":"衝","决":"決","冻":"凍","净":"淨","准":"準","几":"幾","凶":"兇","击":"擊","划":"劃","则":"則","刚":"剛","创":"創","删":"刪","别":"別","务":"務","动":"動","励":"勵","势":"勢","区":"區","协":"協","单":"單","卖":"賣","占":"佔","厅":"廳","历":"歷","压":"壓","参":"參","双":"雙","发":"發","变":"變","台":"臺","号":"號","后":"後","吗":"嗎","听":"聽","启":"啟","员":"員","咨":"諮","团":"團","围":"圍","国":"國","图":"圖","场":"場","坚":"堅","声":"聲","处":"處","备":"備","复":"復","够":"夠","头":"頭","奖":"獎","奥":"奧","娱":"娛","宝":"寶","实":"實","审":"審","宽":"寬","对":"對","导":"導","将":"將","属":"屬","岁":"歲","币":"幣","师":"師","带":"帶","帮":"幫","干":"幹","并":"並","广":"廣","庐":"廬","应":"應","开":"開","异":"異","弃":"棄","张":"張","弹":"彈","强":"強","当":"當","录":"錄","态":"態","总":"總","戏":"戲","户":"戶","扑":"撲","抢":"搶","护":"護","报":"報","担":"擔","拟":"擬","择":"擇","挂":"掛","损":"損","换":"換","据":"據","摊":"攤","数":"數","斩":"斬","断":"斷","无":"無","时":"時","昵":"暱","显":"顯","暂":"暫","术":"術","机":"機","杀":"殺","权":"權","条":"條","来":"來","极":"極","构":"構","标":"標","样":"樣","检":"檢","欢":"歡","气":"氣","汇":"匯","没":"沒","浅":"淺","涨":"漲","游":"遊","滚":"滾","满":"滿","潜":"潛","点":"點","热":"熱","状":"狀","独":"獨","猎":"獵","献":"獻","现":"現","画":"畫","畅":"暢","疯":"瘋","盐":"鹽","盖":"蓋","盘":"盤","码":"碼","确":"確","礼":"禮","离":"離","种":"種","积":"積","称":"稱","笔":"筆","筛":"篩","筹":"籌","签":"籤","简":"簡","类":"類","紧":"緊","红":"紅","约":"約","级":"級","纯":"純","线":"線","组":"組","终":"終","经":"經","绑":"綁","结":"結","给":"給","络":"絡","绝":"絕","统":"統","继":"繼","续":"續","维":"維","综":"綜","绿":"綠","缓":"緩","编":"編","网":"網","联":"聯","胜":"勝","脚":"腳","艺":"藝","节":"節","芦":"蘆","范":"範","荐":"薦","获":"獲","萝":"蘿","营":"營","蓝":"藍","虚":"虛","蛊":"蠱","补":"補","见":"見","观":"觀","规":"規","视":"視","计":"計","订":"訂","认":"認","让":"讓","议":"議","记":"記","许":"許","设":"設","证":"證","识":"識","诈":"詐","试":"試","询":"詢","该":"該","详":"詳","语":"語","误":"誤","说":"說","请":"請","读":"讀","谁":"誰","调":"調","谢":"謝","谨":"謹","贡":"貢","责":"責","败":"敗","账":"帳","货":"貨","质":"質","购":"購","贴":"貼","贵":"貴","费":"費","资":"資","赌":"賭","赏":"賞","赔":"賠","赛":"賽","赠":"贈","赢":"贏","跃":"躍","转":"轉","轮":"輪","载":"載","较":"較","辑":"輯","输":"輸","边":"邊","达":"達","过":"過","运":"運","还":"還","这":"這","进":"進","违":"違","连":"連","迹":"跡","适":"適","选":"選","邮":"郵","里":"裡","鉴":"鑑","钟":"鍾","钮":"鈕","钱":"錢","钻":"鑽","链":"鏈","锁":"鎖","错":"錯","锦":"錦","键":"鍵","长":"長","门":"門","闭":"閉","问":"問","间":"間","阅":"閱","队":"隊","阶":"階","际":"際","险":"險","随":"隨","隐":"隱","静":"靜","页":"頁","顶":"頂","项":"項","顺":"順","须":"須","顾":"顧","领":"領","频":"頻","题":"題","颜":"顏","额":"額","风":"風","馈":"饋","马":"馬","驳":"駁","验":"驗","鱼":"魚","鲜":"鮮","鸡":"雞","黄":"黃","龄":"齡","学":"學","呗":"唄"};

  var STORE_KEY = 'gu9.lang';
  var MANUAL_KEY = 'gu9.langManual';   /* 玩家手动选过 → 永久记住，自动判定不再覆盖 */
  var GEO_KEY = 'gu9.geo';             /* 上次 IP 归属国判定结果，7 天内同步生效（首屏不闪） */
  var GEO_TTL = 7 * 24 * 3600 * 1000;
  var CUR = 'zh-CN';
  var MANUAL = false;
  try { MANUAL = localStorage.getItem(MANUAL_KEY) === '1'; } catch (e) { }
  var ORIG = new WeakMap();   // node -> 原始中文
  var DONE = new WeakMap();   // node -> 当时应用的语言
  var CJK = /[\u4e00-\u9fff]/;
  var ATTRS = ['placeholder', 'title', 'alt', 'aria-label'];

  /* ---------- 英文：全角标点归一 ---------- */
  var PUNC = {
    '，': ', ', '。': '. ', '、': ', ', '：': ': ', '；': '; ',
    '！': '! ', '？': '? ', '（': '(', '）': ')', '「': '"', '」': '"',
    '『': '"', '』': '"', '《': '"', '》': '"', '…': '...', '·': ' · ',
    '～': '~', '—': '-', '％': '%'
  };
  var EN_MAXLEN = 0;
  (function () {
    for (var k in EN) if (k.length > EN_MAXLEN) EN_MAXLEN = k.length;
  })();

  function needSpace(a, b) {
    if (!a || !b) return false;
    var la = a.charAt(a.length - 1), fb = b.charAt(0);
    if (/\s/.test(la) || /\s/.test(fb)) return false;
    if (/[.,:;!?()"'\/·、，。：；！？（）「」《》…]/.test(la)) return false;
    if (/[.,:;!?()"'\/·、，。：；！？（）「」《》…]/.test(fb)) return false;
    if (/[0-9]/.test(la) && /[0-9]/.test(fb)) return false;
    /* 百分号紧跟数字：5% 而不是 5 % */
    if (fb === '%') return false;
    return true;
  }
  /* 连续的半角字符（USDT / BB / VIP / 3BB …）当成一个整体，别拆成 U S D T */
  var ASCII = /[A-Za-z0-9_+.@#&:\-\/]/;
  function push(out, v) {
    if (v === '' || v === null || v === undefined) return out;
    if (needSpace(out, v)) out += ' ';
    return out + v;
  }
  /* 英文翻译：整句命中 → 最长匹配切分 */
  function trEn(s) {
    var hit = EN[s];
    if (hit !== undefined) return hit;
    var out = '', i = 0, L = s.length;
    while (i < L) {
      var got = null, maxL = Math.min(EN_MAXLEN, L - i);
      for (var n = maxL; n >= 1; n--) {
        var sub = s.substr(i, n), v = EN[sub];
        if (v !== undefined) { got = v; i += n; break; }
      }
      if (got !== null) { out = push(out, got); continue; }
      var c = s.charAt(i);
      if (PUNC[c] !== undefined) { out = push(out, PUNC[c]); i++; continue; }
      if (ASCII.test(c)) {
        var j = i;
        while (j < s.length && ASCII.test(s.charAt(j))) j++;
        out = push(out, s.slice(i, j)); i = j; continue;
      }
      out = push(out, c);
      i++;
    }
    return out.replace(/\s+/g, ' ').replace(/ ([,.;:!?])/g, '$1').trim();
  }
  /* 繁体翻译：词条命中 → 词组最长匹配 → 逐字映射 */
  var TW_MAXLEN = 0;
  (function () { for (var k in TW) if (k.length > TW_MAXLEN) TW_MAXLEN = k.length; })();
  function trTw(s) {
    var hit = TW[s];
    if (hit !== undefined) return hit;
    var out = '', i = 0, L = s.length;
    while (i < L) {
      var got = null, maxL = Math.min(TW_MAXLEN, L - i);
      for (var n = maxL; n >= 2; n--) {
        var sub = s.substr(i, n), v = TW[sub];
        if (v !== undefined) { got = v; i += n; break; }
      }
      if (got !== null) { out += got; continue; }
      var c = s.charAt(i);
      out += (TWCHAR[c] !== undefined) ? TWCHAR[c] : c;
      i++;
    }
    return out;
  }
  function tr(s, lang) {
    if (!s || !CJK.test(s)) return s;
    if (lang === 'en' || lang === 'ja' || lang === 'ko') return trEn(s);
    if (lang === 'zh-TW') return trTw(s);
    return s;
  }

  /* ---------- DOM 遍历 ---------- */
  var SKIP_TAG = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, CODE: 1, PRE: 1, TEXTAREA: 1 };
  function skipEl(el) {
    if (!el || el.nodeType !== 1) return false;
    if (SKIP_TAG[el.tagName]) return true;
    if (el.getAttribute && el.getAttribute('data-i18n-skip')) return true;
    /* 不翻玩家自己产生的内容区（聊天输入框里的待发送文本等） */
    if (el.isContentEditable) return true;
    return false;
  }
  function trNode(node) {
    if (!node || node.nodeType !== 3) return;
    var src = ORIG.get(node);
    if (src === undefined) { src = node.nodeValue; ORIG.set(node, src); }
    if (DONE.get(node) === CUR) return;
    var out = tr(src, CUR);
    DONE.set(node, CUR);
    if (out !== node.nodeValue) node.nodeValue = out;
  }
  function trAttrs(el) {
    if (!el || el.nodeType !== 1) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (!el.hasAttribute(a)) continue;
      var mk = el.__i18n_attr || (el.__i18n_attr = {});
      var src = mk[a];
      if (src === undefined) { src = el.getAttribute(a); mk[a] = src; }
      if (!CJK.test(src)) continue;
      var out = tr(src, CUR);
      if (out !== el.getAttribute(a)) el.setAttribute(a, out);
    }
    /* 按钮上的 value 也是可见文案 */
    if (el.tagName === 'INPUT') {
      var ty = (el.type || '').toLowerCase();
      if (ty === 'button' || ty === 'submit' || ty === 'reset') {
        var mk2 = el.__i18n_attr || (el.__i18n_attr = {});
        var s2 = mk2.value;
        if (s2 === undefined) { s2 = el.value; mk2.value = s2; }
        if (CJK.test(s2)) {
          var o2 = tr(s2, CUR);
          if (o2 !== el.value) el.value = o2;
        }
      }
    }
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { trNode(root); return; }
    if (root.nodeType !== 1) return;
    if (skipEl(root)) return;
    trAttrs(root);
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null, false);
    var n = tw.currentNode, guard = 0;
    while (n && guard++ < 20000) {
      if (n.nodeType === 3) trNode(n);
      else if (!skipEl(n)) trAttrs(n);
      n = tw.nextNode();
    }
  }
  function walkAll() {
    walk(document.body);
    if (document.title) {
      if (ORIG.get(document) === undefined) ORIG.set(document, document.title);
      document.title = tr(ORIG.get(document), CUR);
    }
  }

  /* ---------- MutationObserver：兜住所有动态渲染 ---------- */
  var obs = null, pending = [], timer = null, paused = false;
  function flush() {
    timer = null;
    if (paused) return;
    paused = true;
    var list = pending; pending = [];
    for (var i = 0; i < list.length; i++) walk(list[i]);
    if (obs) obs.takeRecords();
    paused = false;
  }
  function startWatch() {
    if (obs || typeof MutationObserver === 'undefined') return;
    obs = new MutationObserver(function (recs) {
      if (paused) return;
      for (var i = 0; i < recs.length; i++) {
        var r = recs[i];
        if (r.type === 'characterData') { pending.push(r.target); }
        else if (r.type === 'childList') {
          for (var j = 0; j < r.addedNodes.length; j++) pending.push(r.addedNodes[j]);
        } else if (r.type === 'attributes') pending.push(r.target);
      }
      if (!timer) timer = setTimeout(flush, 0);
    });
    obs.observe(document.body, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ATTRS.concat(['value'])
    });
  }

  /* ---------- 语言判定 / 切换 ---------- */
  /* 本地缓存的 IP 归属国判定结果（同步可读 → 首屏不闪） */
  function geoCache() {
    try {
      var raw = localStorage.getItem(GEO_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.lang) return null;
      if (Date.now() - (+o.ts || 0) > GEO_TTL) return null;
      var l = norm(o.lang);
      return l ? { ip: o.ip || '', cc: o.cc || '', lang: l } : null;
    } catch (e) { return null; }
  }

  function guess() {
    /* 1. URL 显式指定（分享链接 / 调试用） */
    var m = (location.search || '').match(/[?&]lang=([a-zA-Z-]+)/);
    if (m) { var u = norm(m[1]); if (u) return u; }
    /* 2. 玩家手动选过 → 永远尊重玩家，不再自动切 */
    if (MANUAL) {
      var mv = null;
      try { mv = localStorage.getItem(STORE_KEY); } catch (e) { }
      if (mv) { var mv2 = norm(mv); if (mv2) return mv2; }
    }
    /* 3. IP 归属国：美国 IP → 英文，台湾/香港/澳门 → 繁體，大陆 → 简体 */
    var g = geoCache();
    if (g) return g.lang;
    /* 4. 浏览器语言 */
    var nav = (navigator.language || navigator.userLanguage || '').toLowerCase();
    /* 4. 时区兜底：美国玩家即便系统是中文也直接给英文 */
    var tz = '';
    try { tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || ''); } catch (e) { }
    if (/^America\//i.test(tz)) return 'en';
    if (/^Asia\/(Taipei|Hong_Kong|Macau)/i.test(tz)) {
      if (nav.indexOf('zh') === 0) return 'zh-TW';
    }
    if (nav.indexOf('zh') === 0) {
      if (/tw|hk|mo/.test(nav)) return 'zh-TW';
      return 'zh-CN';
    }
    if (nav.indexOf('en') === 0) return 'en';
    if (nav.indexOf('ja') === 0) return 'ja';
    if (nav.indexOf('ko') === 0) return 'ko';
    /* 其它语种一律给英文，别给中文 */
    return 'en';
  }
  function norm(v) {
    if (!v) return '';
    v = String(v).toLowerCase();
    if (v === 'zh' || v === 'zh-cn' || v === 'cn' || v === 'zh-hans') return 'zh-CN';
    if (v === 'zh-tw' || v === 'zh-hk' || v === 'tw' || v === 'zh-hant') return 'zh-TW';
    if (v === 'en' || v === 'en-us' || v === 'us' || v === 'english') return 'en';
    if (v === 'ja' || v === 'jp' || v === 'ja-jp' || v === 'japanese') return 'ja';
    if (v === 'ko' || v === 'kr' || v === 'ko-kr' || v === 'korean') return 'ko';
    return '';
  }
  var listeners = [];
  function apply(lang, opt) {
    opt = opt || {};
    lang = norm(lang) || 'zh-CN';
    /* 玩家手动选的：永久记住，以后 IP 变了也不再自动改 */
    if (opt.manual) {
      MANUAL = true;
      try { localStorage.setItem(MANUAL_KEY, '1'); } catch (e) { }
    }
    if (lang === CUR && !opt.force) { walkAll(); return CUR; }
    CUR = lang;
    try { localStorage.setItem(STORE_KEY, lang); } catch (e) { }
    walkAll();
    startWatch();
    try { document.documentElement.setAttribute('lang', lang); } catch (e) { }
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](lang); } catch (e) { } }
    return CUR;
  }

  /* ---------- 语言选择弹层 ---------- */
  var SHEET_ID = '__i18n_sheet';
  function closeSheet() {
    var el = document.getElementById(SHEET_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }
  function openSheet() {
    closeSheet();
    var wrap = document.createElement('div');
    wrap.id = SHEET_ID;
    wrap.setAttribute('data-i18n-skip', '1');
    wrap.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:99999;' +
      'background:rgba(15,23,42,.4);display:flex;align-items:center;justify-content:center;';
    var box = document.createElement('div');
    box.setAttribute('data-i18n-skip', '1');
    box.style.cssText = 'width:270px;background:#fff;border-radius:16px;overflow:hidden;' +
      'box-shadow:0 16px 48px rgba(15,23,42,.14);font-size:15px;color:#0f172a;border:1px solid #e4e9f0';
    var title = document.createElement('div');
    title.setAttribute('data-i18n-skip', '1');
    title.style.cssText = 'padding:16px;text-align:center;font-weight:600;letter-spacing:1px;';
    title.textContent = 'SELECT LANGUAGE / 选择语言';
    box.appendChild(title);
    LANGS.forEach(function (l) {
      var row = document.createElement('div');
      row.setAttribute('data-i18n-skip', '1');
      row.setAttribute('data-lang-set', l.k);
      var on = (l.k === CUR);
      row.style.cssText = 'padding:14px 18px;display:flex;align-items:center;gap:10px;cursor:pointer;' +
        'border-top:1px solid #e4e9f0;' + (on ? 'background:rgba(37,99,235,.08);color:#2563eb;' : '');
      row.innerHTML = '<span style="font-size:20px">' + l.flag + '</span>' +
        '<span style="flex:1">' + l.n + '</span>' +
        (on ? '<span style="color:#059669;font-weight:700">✓</span>' : '');
      row.onclick = function () {
        apply(l.k, { manual: true });
        closeSheet();
        var t = ({ en: 'Language: English', ja: '言語: 日本語', ko: '언어: 한국어', 'zh-TW': '已切換為繁體中文', 'zh-CN': '已切换为简体中文' })[l.k] || ('Language: ' + l.n);
        if (global.toast) global.toast(t, 'ok', 2200);
      };
      box.appendChild(row);
    });
    var cancel = document.createElement('div');
    cancel.setAttribute('data-i18n-skip', '1');
    cancel.style.cssText = 'padding:13px;text-align:center;color:#94a3b8;border-top:1px solid #e4e9f0;cursor:pointer;';
    cancel.textContent = '取消 / Cancel';
    cancel.onclick = closeSheet;
    box.appendChild(cancel);
    wrap.appendChild(box);
    wrap.onclick = function (e) { if (e.target === wrap) closeSheet(); };
    document.body.appendChild(wrap);
  }

  /* ---------- 右上角悬浮语言钮 ---------- */
  var BTN_ID = '__i18n_btn';
  function inTable() {
    return !!(global.Route && global.Route.cur === 'table');
  }
  function syncBtn() {
    var btn = document.getElementById(BTN_ID);
    if (!btn) return;
    /* 全局浮动语言钮只在牌桌显示；大厅用 lobby.js 顶栏按钮，子页不显示任何右上角浮动语言钮 */
    btn.style.display = inTable() ? 'flex' : 'none';
    var cur = LANGS.filter(function (l) { return l.k === CUR; })[0] || LANGS[0];
    btn.textContent = cur.s;
    btn.title = 'Language / 语言';
  }
  function mountBtn() {
    if (document.getElementById(BTN_ID)) return;
    var btn = document.createElement('div');
    btn.id = BTN_ID;
    btn.setAttribute('data-i18n-skip', '1');
    btn.style.cssText = 'position:fixed;right:10px;top:10px;z-index:9998;width:38px;height:38px;' +
      'border-radius:50%;background:rgba(255,255,255,.92);color:#475569;border:1px solid #e4e9f0;' +
      'display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;' +
      'cursor:pointer;backdrop-filter:blur(8px);letter-spacing:.5px;box-shadow:0 2px 8px rgba(15,23,42,.08);';
    btn.onclick = openSheet;
    document.body.appendChild(btn);
    syncBtn();
  }

  /* ---------- IP 归属国 → 界面语言 ---------- */
  var GEO = null;   /* {ip, cc, lang} 本次会话服务端判定结果 */

  /* 首屏同步拿一次 IP 归属国：本地有缓存就零延迟，只有"这个 IP 第一次来"才等一下。
     这样美国玩家打开就是英文，不会出现"先中文再跳英文" */
  function geoSync() {
    if (MANUAL) return null;
    var c = geoCache();
    if (c) { GEO = c; return c; }   /* 命中缓存：零延迟，也不再打服务端 */
    try {
      var x = new XMLHttpRequest();
      x.open('GET', '/papi/geo', false);      /* 同步：抢在页面渲染之前定好语言 */
      x.timeout = 2200;
      x.send(null);
      if (x.status === 200 && x.responseText) {
        var j = JSON.parse(x.responseText);
        if (j && j.ok === true && j.lang) {
          var l = norm(j.lang);
          if (l) {
            GEO = { ip: j.ip || '', cc: j.cc || '', lang: l };
            try { localStorage.setItem(GEO_KEY, JSON.stringify({ ip: GEO.ip, cc: GEO.cc, lang: l, ts: Date.now() })); } catch (e2) { }
            return GEO;
          }
        }
      }
    } catch (e) { }
    return null;
  }
  try { geoSync(); } catch (e) { }

  function pickGeo() {
    /* 玩家手动选过就别自作主张 */
    if (MANUAL) { syncBtn(); return Promise.resolve(''); }
    return fetch('/papi/geo', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || j.ok !== true || !j.lang) return '';
        var l = norm(j.lang);
        if (!l) return '';
        GEO = { ip: j.ip || '', cc: j.cc || '', lang: l };
        try {
          localStorage.setItem(GEO_KEY, JSON.stringify({ ip: GEO.ip, cc: GEO.cc, lang: l, ts: Date.now() }));
        } catch (e) { }
        /* IP 归属国没变就别来回跳；变了才切 */
        if (!MANUAL && l !== CUR) apply(l);
        syncBtn();
        return l;
      })
      .catch(function () { return ''; });
  }

  /* ---------- 导出 ---------- */
  var I18N = {
    langs: LANGS,
    get: function () { return CUR; },
    t: function (s, lang) { return tr(s, lang || CUR); },
    apply: apply,
    guess: guess,
    norm: norm,
    open: openSheet,
    close: closeSheet,
    onChange: function (fn) { if (fn) listeners.push(fn); },
    refresh: function () { walkAll(); },
    /* 供登录/注册后把服务端存的账号语言套上来；
       优先级：玩家手动选 > IP 归属国 > 账号里存的语言 */
    fromUser: function (u) {
      if (u && u.lang) {
        var l = norm(u.lang);
        if (l && !MANUAL && !(GEO && GEO.lang)) apply(l);
      }
      syncBtn();
    },
    /* 美国手机号 → 默认英文（注册时用） */
    fromPhone: function (cc) {
      var c = String(cc || '').replace(/[^0-9]/g, '');
      if (c === '1') return 'en';
      return '';
    },
    /* 玩家有没有手动选过语言（自动判定不应覆盖手动选择） */
    manual: function () { return MANUAL; },
    /* 按 IP 归属国重新判定（换网络 / 换国家后调一次） */
    pickGeo: pickGeo,
    geo: function () { return GEO; },
    /* 恢复"跟着 IP 走"（清掉手动标记，调试/后台用） */
    auto: function () {
      MANUAL = false;
      try { localStorage.removeItem(MANUAL_KEY); localStorage.removeItem(GEO_KEY); } catch (e) { }
      return pickGeo();
    }
  };
  global.I18N = I18N;

  /* ---------- 启动 ---------- */
  function boot() {
    apply(guess());
    mountBtn();
    startWatch();
    /* 首屏同步没拿到（首次访问超时 / 老浏览器）：立刻异步补一次；
       已拿到缓存的：3 秒后静默校一次，换国家 / 换网络也能跟上 */
    if (!GEO) pickGeo(); else setTimeout(function () { pickGeo(); }, 3000);
    /* 路由切换后（单页应用）重扫一次，避免漏翻 */
    var t = setInterval(function () { syncBtn(); }, 1200);
    window.addEventListener('popstate', function () { setTimeout(walkAll, 60); });
    document.addEventListener('click', function (e) {
      var n = e.target;
      while (n && n !== document) {
        if (n.nodeType === 1 && n.getAttribute && n.getAttribute('data-lang-open') !== null) {
          openSheet(); return;
        }
        n = n.parentNode;
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
})(window);

