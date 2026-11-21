# 海豚云发布会 · 配乐与音效（P12）

本地文件都在 `audio/`（已被 `.gitignore` 忽略，不进仓库）：开场曲在 `audio/music/`，音效在 `audio/sfx/`。下文的时间写法：“曲 87.2 s”指曲子本身的秒数，“片 1:15”指成片时间。

## 选用

- **开场曲：01 Dreaming Big**（Ahjay Stelino，Mixkit Stock Music Free License，无需署名）。钢琴加弦乐，正好接开场片的钢琴单音。
- 卡点：片时间 = 曲时间 − 12.2 s。片 0:11 从曲 23.2 s 起播，淡入 3 s；片 1:15 对曲 87.2 s 的骤停，留 0.5 s 尾音后完全安静。
- 标题段（片 1:20）的 18 下鼓点沿用这首曲子的速度 135 BPM：先 4 个四分音符，再 4 个八分音符，最后 10 个十六分音符，每下对一笔金额闪出；鼓点用落地通鼓单击（`fs_378378`），起音提前 43 ms 放。
- 结尾回顾（片 11:40–11:52）用曲 75.2–87.2 s，在 87.2 s 切断，接 11:52 黑场的余音。
- 开场片 0:00–1:45 的音乐与音效由 `scripts/opening-mix.sh` 混成 `../out/titles/opening-mix.wav`，每个音效的位置写在脚本里；`Opening-Animatic` 合成是配上这条音轨的卡点预览（实拍镜头为占位卡）。

## 开场曲候选

三首都能免费商用，无需付费或登录，音频文件直接从曲库下载。

| 编号 | 曲名 | 作者 | 来源链接 | 许可与署名要求 | 时长 | 起势 / 高潮 / 骤停（曲内时间） | 对齐建议 | 本地文件 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01 | Dreaming Big（钢琴与弦乐，电影感，明亮激昂） | Ahjay Stelino | https://mixkit.co/free-stock-music/discover/dreaming-big/ （音频 https://assets.mixkit.co/music/31/31.mp3） | Mixkit Stock Music Free License（https://mixkit.co/license/#musicFree）：商用、非商用都免费，无需署名；不得用于电视或广播播出、CD 或 DVD、电子游戏；不得混音成纯音乐作品、署成自己的作品或登记到版权管理服务 | 1:50（110.4 s） | 起势 26 s（−16 → −14 LUFS，一路升到 44 s 的 −12）/ 高潮 72.9 s（一拍内从 −12 跳到 −8，满编持续到 87 s）/ 骤停 87.2 s（8 小节高潮乐句结束的强拍，135 BPM） | 片 1:15 对曲 87.2 s，即片时间 = 曲时间 − 12.2 s。片 0:11 从曲 23.2 s 起播，淡入 3 s（片 0:00–0:11 只留钢琴单音和锁扣）。片 0:35 对曲 47.2 s（已上到 −12 平台），高潮在片 1:00.7 进入，片 1:03 正在最满处。结尾回顾：曲 75.2–87.2 s 放在片 11:40–11:52，在 87.2 s 切断并加混响尾巴，接 11:52 黑场的余音 | `audio/music/01-dreaming-big.mp3`；试听 `audio/music/preview-01.mp3`（曲 52.0–88.2 s，36 s） |
| 02 | Mountains（轻电子节拍，从很弱慢慢推起） | Andrew Ev | https://mixkit.co/free-stock-music/discover/mountains/ （音频 https://assets.mixkit.co/music/187/187.mp3） | 同 01：Mixkit Stock Music Free License，无需署名，限制同上 | 4:37（277.3 s） | 起势 32.3 s（−20 → −13 LUFS 的第一次涌起，此前从 −45 慢慢上升）/ 节奏进入 47.35 s（跳到 −11）/ 高潮 79.0 s（−10 起进入满编平台）/ 骤停 86.9 s（小节强拍，121.5 BPM，1 小节 1.975 s） | 片 1:15 对曲 86.9 s，即片时间 = 曲时间 − 11.9 s。片 0:00 从曲 11.9 s 起播（此处约 −28 LUFS，很弱，可垫在钢琴单音下面），淡入 2 s。节奏进入落在片 0:35.5，正对“音乐进入节奏”；片 1:03 对曲 74.9 s，满编平台从片 1:07 开始。结尾回顾：曲 74.9–86.9 s 放在片 11:40–11:52 | `audio/music/02-mountains.mp3`；试听 `audio/music/preview-02.mp3`（曲 46.0–87.9 s，42 s） |
| 03 | Impact Allegretto（打击乐推进，吉他与合成器点缀） | Kevin MacLeod | https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100622 （音频 https://incompetech.com/music/royalty-free/mp3-royaltyfree/Impact%20Allegretto.mp3） | CC BY 4.0（https://creativecommons.org/licenses/by/4.0/）：免费，必须署名，影片的署名放在片尾字幕；署名原文见下一节 | 3:02（182.1 s） | 起势 112.2 s（−19 → −11 LUFS，作者说明里的大转折之后最大的一次抬升；此前 93–112 s 是 −18 的弱段）/ 高潮 146.7 s（−10，全曲最响的段落，持续到 160 s）/ 骤停 160.6 s（曲子本身在这里收住，160.8–163.0 s 自然衰减，自带“半秒回声”） | 片 1:15 对曲 160.6 s，即片时间 = 曲时间 − 85.6 s。片 0:11 从曲 96.6 s 起播，淡入 2 s。抬升落在片 0:26.6，比“0:28 第一次抬升”早 1.4 s，可把涟漪镜头提前 1.4 s；高潮在片 1:01.1 进入。曲 163.1 s 起打击乐重新进入，对应片 1:17.5，要静音。结尾回顾：曲 148.6–160.6 s 放在片 11:40–11:52，曲子自己的衰减正好做余音 | `audio/music/03-impact-allegretto.mp3`；试听 `audio/music/preview-03.mp3`（曲 128.0–162.0 s，34 s） |

### 时间点是怎么判断的

- 响度曲线：`ffmpeg -v verbose -i <曲> -af ebur128=framelog=verbose -f null -`，每秒取一次 S 值（3 秒短期响度）看整体走势，再在转折附近取 M 值（0.4 秒瞬时响度，每 0.1 秒一个）定准到 0.1 s。
- 起势：短期响度开始持续上升、或比前一段跳高 3 dB 以上的位置。高潮：短期响度达到全曲最高平台的起点。骤停：高潮段里乐句结束、紧接着响度回落的那一拍。
- 节拍：把音频降到 8 kHz 单声道，每 10 ms 算能量，取能量的正向变化作为起音强度，用自相关求速度（01 是 135 BPM，02 是 121.5 BPM；03 用 Incompetech 标注的 120 BPM，实测 119），再拟合节拍相位，把骤停点放在小节强拍上。
- 这些判断只来自响度和节拍分析，没有人耳试听。乐器在哪一刻进来（例如鼓点在不在 0:55）以试听为准，必要时在剪辑里前后挪一两个小节（01 一小节 1.78 s，02 一小节 1.98 s，03 一小节 2.0 s）。

### 对齐脚本的通用做法

- 统一用“片 1:15 = 骤停点”来定起播位置：起播的曲内时间 = 骤停点 − 75 s + 片内起播时间。
- 1:15 在骤停点硬切，叠 0.5 s 的混响尾巴（03 可以直接用曲子自己的衰减），1:17 起完全安静。
- 1:20 标题段的“一笔一拍、越来越快”另做鼓点，不用这三首曲子；1:25 的钢琴单音用下面音效表里的钢琴音，和 0:00 是同一个文件。
- 11:40 回顾短片用骤停点前 12 s 的高潮乐句，在 11:52 黑场处切断留余音，开场和结尾就是同一段主题。

## 音效

全部来自 Freesound，已逐个打开页面确认许可。文件是 Freesound 的高质量试听版（MP3，约 180 kbps，48 kHz）；要无损原文件（WAV/AIFF），需要用户登录 Freesound 后在同一页面下载。

| 用途（脚本时间点） | 文件 | Freesound 链接 | 作者 | 许可 | 时长 | 使用说明 |
| --- | --- | --- | --- | --- | --- | --- |
| 钢琴单音，长余音（0:00、0:08 第二个音、1:25） | `audio/sfx/fs_794463_Upright-Piano-Remeau-up-close-XY-G4.mp3` | https://freesound.org/people/Sadiquecat/sounds/794463/ | Sadiquecat | CC0 | 7.6 s | 立式钢琴近距离 XY 录音的 G4，余音到 6.4 s 才降到 −40 dB。0:08 的第二个音可用同一文件升 2～5 个半音 |
| 钢琴单音备选 | `audio/sfx/fs_467047_Piano-Note-wav.mp3` | https://freesound.org/people/kelsey_w/sounds/467047/ | kelsey_w | CC BY 3.0（需署名） | 13.4 s | 旧钢琴单音，作者说明适合强调重要时刻；余音 6.8 s，电平偏低，需加约 15 dB |
| 金属锁扣“咔哒”（0:04；0:59“门锁扣上”） | `audio/sfx/fs_545521_briefcase-latch-open-close-click-wav.mp3` | https://freesound.org/people/rsellick/sounds/545521/ | rsellick | CC0 | 11.8 s | 公文包锁扣开合，含多次咔哒（0.59、2.26、4.46、6.25、8.18 s），2.26 s 那一下最响 |
| 锁扣备选 | `audio/sfx/fs_822397_small-metal-clasp-open-close-switching.mp3` | https://freesound.org/people/_sinny_/sounds/822397/ | _sinny_ | CC0 | 0.2 s | 小金属扣，单次，很干净 |
| 水滴落进水洼（0:15） | `audio/sfx/fs_683102_water-drop.mp3` | https://freesound.org/people/florianreichelt/sounds/683102/ | florianreichelt | CC0 | 1.7 s | ↓2539、★4.9（58 票）；起音在 0.09 s |
| 水滴备选 | `audio/sfx/fs_533146_Drop-Water.mp3` | https://freesound.org/people/mattfinarelli/sounds/533146/ | mattfinarelli | CC0 | 0.6 s | ↓2993、★4.7（47 票）；起音在 0.24 s |
| 纸币轻落手心（0:20，与水滴叠在一拍） | `audio/sfx/fs_497133_Paper-landing-m4a.mp3` | https://freesound.org/people/cpick/sounds/497133/ | cpick | CC0 | 5.6 s | 纸张落下，落点在 2.88 s，电平低，需加约 10 dB |
| 纸币落下备选 | `audio/sfx/fs_46625_dropping-and-sliding-paper-wav.mp3` | https://freesound.org/people/123jorre456/sounds/46625/ | 123jorre456 | CC0 | 2.7 s | 纸落在桌上再滑动，取 0–1 s 的落点；电平很低 |
| 百叶窗拉起（0:43） | `audio/sfx/fs_347892_window-blinds-raise-01-wav.mp3` | https://freesound.org/people/newagesoup/sounds/347892/ | newagesoup | CC0 | 1.4 s | 拉起百叶窗，★4.8（12 票） |
| 百叶窗备选 | `audio/sfx/fs_145385_Blinds-Open-aif.mp3` | https://freesound.org/people/timgormly/sounds/145385/ | timgormly | CC0 | 1.7 s | Zoom H4n 录的百叶窗打开 |
| 纸币翻动、数钱（0:47） | `audio/sfx/fs_538771_Manual-banknote-counting-mp3.mp3` | https://freesound.org/people/sounds-mp3/sounds/538771/ | sounds-mp3 | CC0 | 17.6 s | 手工点钞，取 0–6 s |
| 数钱备选 | `audio/sfx/fs_18623_money-count-aif.mp3` | https://freesound.org/people/Walter_Odington/sounds/18623/ | Walter_Odington | CC0 | 7.0 s | 手指翻纸币，作者说明底噪略大 |
| 键盘回车（0:51；0:59“回车键按下”） | `audio/sfx/fs_627647_Enter-Key-Press-Mechanical-Keyboard.mp3` | https://freesound.org/people/alpinemesh/sounds/627647/ | alpinemesh | CC0 | 0.2 s | 机械键盘（Corsair K70）回车，单次 |
| 回车备选 | `audio/sfx/fs_180997_enter-key.mp3` | https://freesound.org/people/uEffects/sounds/180997/ | uEffects | CC0 | 0.2 s | 为视频预告片录的回车键，★4.8（18 票） |
| 轻轻的“叮”（1:11） | `audio/sfx/fs_611113_bell-ding-1-wav.mp3` | https://freesound.org/people/5ro4/sounds/611113/ | 5ro4 | CC0 | 2.5 s | 训练铃的“叮”，↓11098、★4.6（214 票），余音 1.2 s |
| “叮”备选 | `audio/sfx/fs_554803_Glass-Ding.mp3` | https://freesound.org/people/LoafDV/sounds/554803/ | LoafDV | CC BY 4.0（需署名） | 0.6 s | 轻敲半杯水的玻璃杯，更短更轻 |
| 低音冲击 sub boom（1:29 硬切到 App 图标；也可垫在 1:20 标题段最后一拍） | `audio/sfx/fs_428073_Sub-Drop-Smooth-wav.mp3` | https://freesound.org/people/newagesoup/sounds/428073/ | newagesoup | CC0 | 3.8 s | 平滑的低频下沉，峰值在 0.49 s，3.6 s 衰减完，↓4674、★4.7（74 票） |
| 低音冲击备选 | `audio/sfx/fs_710368_Cinematic-Punch.mp3` | https://freesound.org/people/mittenboy/sounds/710368/ | mittenboy | CC0 | 7.8 s | 更硬的一击，尾部是胸腔共振的低频，起音 0.52 s |
| 标题段鼓点（1:20–1:24） | `audio/sfx/fs_378378_Floor-tom-wav.mp3` | https://freesound.org/people/karolist/sounds/378378/ | karolist | CC0 | 0.22 s | 录音棚实录的落地通鼓，单击。起音 0.043 s，峰值 0.052 s（−5 dBFS），9 ms 升到峰值；起音后 110 ms 已降约 14 dB，0.177 s 衰减到 −40 dB，最密 0.11 s 一下时前后两下不糊。每下提前 43 ms 放，起音就正落在金额闪出的那一帧 |
| 标题段鼓点（1:20–1:24）备选 | `audio/sfx/fs_268108_Button-Tick.mp3` | https://freesound.org/people/NenadSimic/sounds/268108/ | NenadSimic | CC0 | 0.22 s | 短促的“滴答”点击，↓5240、★4.8（51 票）。起音 0.006 s，峰值 0.011 s（−4 dBFS），25 ms 内衰减到 −40 dB |
| 海浪（1:29 三层海浪升起；1:35 大屏海浪） | `audio/sfx/fs_531015_Ocean-Waves-wav.mp3` | https://freesound.org/people/Noted451/sounds/531015/ | Noted451 | CC0 | 70.9 s | 实录海浪，↓42370、★4.3（346 票）；浪头约每 3～5 s 一次 |
| 礼堂环境声（1:35 礼堂空镜） | `audio/sfx/fs_718274_empty-lecture-theatre-ambience-stereo.mp3` | https://freesound.org/people/busabx/sounds/718274/ | busabx | CC BY 4.0（需署名） | 105.2 s | 空的阶梯礼堂底噪，立体声 |
| 礼堂环境声备选 | `audio/sfx/fs_212137_RoomTone-Hall-32x8x3-AC-SHORT-130626_01-.mp3` | https://freesound.org/people/klankbeeld/sounds/212137/ | klankbeeld | CC BY 4.0（需署名） | 122.2 s | 32×8×3 米大厅的空间底噪，带空调声 |
| 脚步声，礼堂木地板（1:38） | `audio/sfx/fs_272490_Footsteps_on_stage_Simple_with_reverb-wa.mp3` | https://freesound.org/people/Ferguido/sounds/272490/ | Ferguido | CC0 | 3.4 s | 木舞台上的脚步，带房间混响；电平很低（峰值 −48 dBFS），需加约 25 dB |
| 脚步声备选 | `audio/sfx/fs_459970_Footsteps-on-hollow-wood.mp3` | https://freesound.org/people/florianreichelt/sounds/459970/ | florianreichelt | CC0 | 27.0 s | 空心木地板脚步，↓10359、★4.8（157 票），步距约 0.5 s |
| 关灯开关“咔哒”（11:55 片尾彩蛋） | `audio/sfx/fs_440499_Light-Switch-Turn-Off-Sound.mp3` | https://freesound.org/people/ChrisTutorials/sounds/440499/ | ChrisTutorials | CC0 | 0.4 s | 墙壁开关关灯，单次，★4.6（41 票） |

## 片尾署名

Mixkit 的 01、02 和所有 CC0 音效不需要署名。以下内容只要用进成片，就要在片尾字幕里写出署名；放到网上时，视频简介里也写一份。

开场曲选 03 时：

```
"Impact Allegretto" Kevin MacLeod (incompetech.com)
Licensed under Creative Commons: By Attribution 4.0
https://creativecommons.org/licenses/by/4.0/
```

礼堂环境声（首选）：

```
"empty lecture theatre ambience stereo" by busabx (https://freesound.org/s/718274/), licensed under CC BY 4.0
```

用到备选时再加对应一行：

```
"Piano Note.wav" by kelsey_w (https://freesound.org/s/467047/), licensed under CC BY 3.0
"Glass Ding" by LoafDV (https://freesound.org/s/554803/), licensed under CC BY 4.0
"RoomTone Hall 32x8x3 AC SHORT 130626_01.wav" by klankbeeld (https://freesound.org/s/212137/), licensed under CC BY 4.0
```

Mixkit 曲目的播放范围：许可允许网络和社交平台、YouTube、播客、广告和教育用途，不包括电视或广播播出、CD 或 DVD。发布会若会在电视台播出或刻盘发行，选 03，或另购授权。
