/**
 * Botchelor's characters are originals (docs/PRDs/styles-and-storylines.md, phase 5). This names the franchise a
 * character's own words come from, if any: 117 franchises from our census of AI-character sites (2026-11-17), with
 * their titles in English, Chinese, Japanese and Korean and the character names those sites use most.
 *
 * - **Matching:** Latin names on word boundaries ("geralt", not "geraltine"), in any case and spacing. Chinese, Japanese
 *   and Korean names match anywhere, since those scripts don't put spaces between words.
 * - **Left out:** names that are everyday words ("arcane", "dune"), real first names ("ariel", "kazuha"), myths and fairy
 *   tales in the public domain ("loki", "cinderella"), studios a character could work at ("disney"), and phrases a bio
 *   could say about anyone ("one piece", "the joker"). Each franchise's other names still catch it.
 * - **A fan isn't a copy:** a title ("Genshin", "Pokémon cards", "a Star Wars marathon") counts only where a character
 *   says who they are and how they look (IDENTITY_FIELDS: the name, appearance, look, role and costume), never in a bio
 *   or a hobby. A character's name ("Tifa Lockhart") or a place ("Hogwarts") counts anywhere.
 * - **What it's for:** people's characters get a warning (the originality panel and the MCP's create reply). Botchelor's
 *   own (the house, season-gen, recasts, the agent casts) and After Dark's are refused.
 */

import { escapeRegExp } from "./text";

export type FranchiseKind = "anime" | "game" | "western" | "webtoon" | "vtuber" | "music";

/** Franchise, kind and its names: comma-separated, lower case. */
const FRANCHISES: readonly (readonly [name: string, kind: FranchiseKind, aliases: string])[] = [
  ["Genshin Impact", "game", "genshin, raiden shogun, raiden ei, zhongli, tartaglia, childe, hu tao, ganyu, yae miko, kaedehara kazuha, scaramouche, diluc, kaeya, kamisato ayaka, kamisato ayato, furina, neuvillette, wriothesley, navia, klee genshin, mavuika, xilonen, kinich, alhaitham, cyno, tighnari, arataki itto, lyney, clorinde, dainsleif, lumine, keqing, shenhe, yelan, ningguang, xingqiu, kokomi, yoimiya, dehya, xiao genshin, albedo genshin, wanderer genshin, skirk, varesa, teyvat, 原神"],
  ["Honkai: Star Rail", "game", "honkai star rail, honkai: star rail, star rail, kafka hsr, dan heng, jing yuan, dr. ratio, dr ratio, sparkle hsr, himeko hsr, welt yang, black swan hsr, jingliu, ruan mei, topaz hsr, argenti, sampo koski, gepard, bronya rand, seele vollerei, the herta, rappa hsr, feixiao, jiaoqiu, yunli, castorice, phainon, mydei, tribbie, anaxa, hyacine, blade hsr, firefly hsr, robin hsr, sunday hsr, 星穹铁道, 星穹鐵道, スターレイル, 붕괴: 스타레일"],
  ["Honkai Impact 3rd", "game", "honkai impact, kiana kaslana, raiden mei, elysia honkai, fu hua, 崩坏3, 崩坏三, 崩壊3rd, 崩坏学园"],
  ["Zenless Zone Zero", "game", "zenless zone zero, zenless, ellen joe, hoshimi miyabi, miyabi zzz, zhu yuan, von lycaon, nicole demara, burnice, tsukishiro yanagi, asaba harumasa, evelyn chevalier, astra yao, anby demara, nekomata zzz, grace howard, soldier 11, caesar king, lighter zzz, vivian banshee, hugo vlad, yuzuha, jane doe zzz, belle zzz, wise zzz, 绝区零, 絕區零, ゼンレスゾーンゼロ, 젠레스 존 제로"],
  ["Wuthering Waves", "game", "wuthering waves, wuwa, jiyan, jinhsi, camellya, shorekeeper, carlotta wuwa, phrolova, cartethyia, zani wuwa, phoebe wuwa, 鸣潮, 鳴潮"],
  ["Blue Archive", "game", "blue archive, hoshino takanashi, shiroko sunaookami, aru rikuhachima, hina sorasaki, yuuka hayase, kivotos, 蔚蓝档案, 碧蓝档案, 蔚藍檔案, ブルーアーカイブ, ブルアカ, 블루 아카이브, 블루아카"],
  ["Umamusume: Pretty Derby", "game", "umamusume, uma musume, pretty derby, tracen academy, agnes tachyon, silence suzuka, tokai teio, mejiro mcqueen, haru urara, kitasan black, satono diamond, daiwa scarlet, symboli rudolf, oguri cap, manhattan cafe, mihono bourbon, 赛马娘, 賽馬娘, ウマ娘, 우마무스메"],
  ["Arknights", "game", "arknights, amiya arknights, exusiai, skadi arknights, kal'tsit, texas arknights, 明日方舟, アークナイツ, 명일방주"],
  ["Azur Lane", "game", "azur lane, taihou azur, atago azur, belfast azur, 碧蓝航线, 碧藍航線, アズールレーン, 벽람항로"],
  ["Goddess of Victory: Nikke", "game", "nikke, 妮姬"],
  ["Fate series", "game", "fate/grand order, fate grand order, fgo, fate/stay night, fate stay night, artoria pendragon, saber fate, gilgamesh fate, jeanne alter, tamamo no mae, mash kyrielight, 命运冠位指定, 命運冠位指定, フェイト/グランドオーダー, 型月"],
  ["League of Legends / Arcane", "game", "league of legends, ahri, jinx arcane, jinx league, caitlyn kiramman, vi arcane, jayce talis, viktor arcane, silco, ekko arcane, akali, kai'sa, viego, yone league, aphelios, katarina league, irelia, miss fortune, k/da, mel medarda, ambessa, 英雄联盟, 英雄聯盟, 리그 오브 레전드"],
  ["Valorant", "game", "valorant, jett valorant, reyna valorant, sage valorant, chamber valorant, omen valorant, yoru valorant, neon valorant, clove valorant"],
  ["Overwatch", "game", "overwatch, d.va, mercy overwatch, widowmaker, tracer overwatch, kiriko overwatch, genji shimada, hanzo shimada, reaper overwatch, cassidy overwatch, soldier 76, junker queen, sombra overwatch, lifeweaver"],
  ["Final Fantasy", "game", "final fantasy, cloud strife, tifa lockhart, aerith, sephiroth, noctis, lightning farron, squall leonhart, zack fair, vincent valentine, clive rosfield, y'shtola, emet-selch, estinien, ignis scientia, prompto argentum, ファイナルファンタジー, 最终幻想, 最終幻想"],
  ["Resident Evil", "game", "resident evil, leon kennedy, leon s. kennedy, ada wong, jill valentine, chris redfield, claire redfield, albert wesker, lady dimitrescu, karl heisenberg, luis serra, ethan winters"],
  ["Call of Duty", "game", "call of duty, simon riley, ghost riley, simon ghost riley, soap mactavish, johnny mactavish, captain price, kyle garrick, alejandro vargas, rodolfo parra, task force 141, tf141"],
  ["Persona", "game", "persona 5, persona 4, persona 3, ren amamiya, akira kurusu, goro akechi, makoto niijima, ann takamaki, ryuji sakamoto, yu narukami, makoto yuki, ryoji mochizuki, ペルソナ5, ペルソナ4, ペルソナ3, 女神异闻录, 女神異聞錄"],
  ["The Legend of Zelda", "game", "legend of zelda, princess zelda, ganondorf, link zelda, hyrule, ゼルダの伝説, 塞尔达传说, 薩爾達傳說"],
  ["Super Mario / Nintendo", "game", "super mario, princess peach, samus aran, splatoon, animal crossing, スーパーマリオ, 超级马力欧, 超級瑪利歐, 任天堂"],
  ["Pokémon", "game", "pokemon, pokémon, pikachu, gardevoir, lucario, ash ketchum, cynthia pokemon, lusamine, nemona, 宝可梦, 寶可夢, 精灵宝可梦, ポケモン, ポケットモンスター, 포켓몬"],
  ["Street Fighter / Tekken / Mortal Kombat", "game", "street fighter, chun-li, chun li, cammy white, juri han, tekken, jin kazama, kazuya mishima, mortal kombat, kitana, mileena, ストリートファイター, 街头霸王, 街頭霸王"],
  ["The Witcher", "game", "witcher, geralt of rivia, geralt, yennefer, ciri witcher, triss merigold, jaskier"],
  ["Cyberpunk 2077", "game", "cyberpunk 2077, johnny silverhand, judy alvarez, panam palmer, kerry eurodyne, goro takemura"],
  ["Baldur's Gate 3", "game", "baldur's gate, baldurs gate, bg3, astarion, shadowheart, karlach, lae'zel, laezel, gale dekarios, halsin, wyll ravengard, minthara, gortash"],
  ["Elden Ring / Souls", "game", "elden ring, malenia, ranni the witch, radahn, dark souls, bloodborne, sekiro, エルデンリング, 艾尔登法环, 艾爾登法環"],
  ["Undertale / Deltarune", "game", "undertale, deltarune, sans undertale, papyrus undertale, toriel, asgore, spamton, ralsei"],
  ["Five Nights at Freddy's", "game", "five nights at freddy, fnaf, freddy fazbear, springtrap, william afton, michael afton, glamrock, sun and moon fnaf, circus baby"],
  ["Doki Doki Literature Club", "game", "doki doki literature club, ddlc, monika ddlc, just monika"],
  ["Danganronpa", "game", "danganronpa, nagito komaeda, komaeda, kokichi ouma, kokichi oma, junko enoshima, makoto naegi, byakuya togami, shuichi saihara, monokuma, izuru kamukura, ダンガンロンパ, 弹丸论破, 槍彈辯駁"],
  ["Minecraft / Roblox / Fortnite", "game", "minecraft, herobrine, roblox, fortnite"],
  ["Apex Legends", "game", "apex legends"],
  ["Detroit: Become Human", "game", "detroit become human, detroit: become human, rk800, rk900, connor dbh"],
  ["Red Dead Redemption", "game", "red dead redemption, arthur morgan, john marston, dutch van der linde, sadie adler"],
  ["The Last of Us", "game", "tlou, joel miller, ellie williams"],
  ["NieR", "game", "nier automata, nier: automata, 2b nier, yorha, ニーアオートマタ, 尼尔机械纪元, 尼爾自動人形"],
  ["Stellar Blade", "game", "stellar blade, 剑星, 劍星, 스텔라 블레이드"],
  ["Hades", "game", "zagreus, melinoe, hades ii, hades 2"],
  ["RWBY", "western", "rwby, weiss schnee, blake belladonna, yang xiao long"],
  ["Love and Deepspace", "game", "love and deepspace, love & deepspace, rafayel, sylus lads, xavier lads, zayne lads, caleb lads, 恋与深空, 戀與深空, 恋と深空"],
  ["Otome & gacha (other)", "game", "mystic messenger, tears of themis, ensemble stars, twisted wonderland, twisted-wonderland, identity v, project sekai, limbus company, lobotomy corporation, library of ruina, cookie run, helltaker, punishing gray raven, reverse: 1999, reverse 1999, girls' frontline, girls frontline, uma musume, umamusume, idolmaster"],
  ["Hazbin Hotel / Helluva Boss", "western", "hazbin hotel, helluva boss, alastor, charlie morningstar, vaggie, husk hazbin, adam hazbin, lute hazbin, vox hazbin, valentino hazbin, velvette, sir pentious, blitzo, stolas, moxxie, loona helluva, fizzarolli"],
  ["Murder Drones / Glitch", "western", "murder drones, uzi doorman, amazing digital circus, digital circus, pomni, caine tadc, jax tadc, ragatha"],
  ["Poppy Playtime / indie horror", "game", "poppy playtime, huggy wuggy, catnap, dogday, dandy's world"],
  ["Fire Emblem", "game", "fire emblem, edelgard, dimitri fire emblem, claude von riegan, sylvain, felix fraldarius, byleth"],
  ["Kingdom Hearts", "game", "kingdom hearts, riku kingdom hearts, roxas, vanitas kingdom hearts, xemnas, キングダムハーツ, 王国之心"],
  ["Devil May Cry", "game", "devil may cry, dante dmc, vergil dmc, vergil sparda, nero dmc"],
  ["Dragon Age / Mass Effect", "game", "dragon age, mass effect, garrus vakarian, liara t'soni, fenris dragon age, alistair theirin, varric, dorian pavus, cullen rutherford, solas"],
  ["God of War", "game", "kratos, atreus"],
  ["Team Fortress 2", "game", "team fortress 2"],
  ["Touhou Project", "game", "touhou, reimu hakurei, marisa kirisame, sakuya izayoi, remilia scarlet, flandre scarlet, yukari yakumo, koishi komeiji, 东方project, 東方project, 東方プロジェクト, 东方幻想乡, 東方幻想郷"],
  ["Vocaloid", "music", "hatsune miku, vocaloid, kagamine rin, kagamine len, megurine luka, kasane teto, 初音ミク, 初音未来, 初音未來, ボーカロイド, 镜音铃, 鏡音リン"],
  ["Omori", "game", "omori"],
  ["Jujutsu Kaisen", "anime", "jujutsu kaisen, jjk, gojo satoru, satoru gojo, gojo, sukuna, ryomen sukuna, megumi fushiguro, fushiguro, yuji itadori, itadori, nanami kento, kento nanami, toji fushiguro, suguru geto, geto suguru, nobara kugisaki, maki zenin, yuta okkotsu, choso, mahito jjk, kenjaku, hakari kinji, naoya zenin, 呪術廻戦, 咒术回战, 咒術迴戰, 주술회전"],
  ["Demon Slayer", "anime", "kimetsu no yaiba, tanjiro, nezuko, zenitsu, inosuke, rengoku, kyojuro, giyu tomioka, giyuu, shinobu kocho, mitsuri kanroji, tengen uzui, muichiro, sanemi, obanai, muzan, akaza, douma, kokushibo, kanao tsuyuri, 鬼滅の刃, 鬼灭之刃, 鬼滅之刃, 귀멸의 칼날"],
  ["Attack on Titan", "anime", "attack on titan, shingeki no kyojin, levi ackerman, captain levi, eren yeager, eren jaeger, mikasa ackerman, armin arlert, erwin smith, hange zoe, reiner braun, zeke yeager, jean kirstein, annie leonhart, historia reiss, 進撃の巨人, 进击的巨人, 進擊的巨人, 진격의 거인"],
  ["My Hero Academia", "anime", "my hero academia, boku no hero, bnha, katsuki bakugo, bakugo, bakugou, izuku midoriya, deku, shoto todoroki, todoroki, dabi, keigo takami, hawks mha, tomura shigaraki, shigaraki, shota aizawa, eijiro kirishima, denki kaminari, ochaco uraraka, momo yaoyorozu, himiko toga, toga himiko, endeavor mha, hitoshi shinso, tamaki amajiki, mirio togata, 僕のヒーローアカデミア, ヒロアカ, 我的英雄学院, 我的英雄學院, 나의 히어로 아카데미아"],
  ["Chainsaw Man", "anime", "chainsaw man, makima, denji, aki hayakawa, reze chainsaw, kobeni, himeno chainsaw, power chainsaw, チェンソーマン, 电锯人, 鏈鋸人, 체인소 맨"],
  ["Spy x Family", "anime", "spy x family, yor forger, loid forger, anya forger, スパイファミリー, 间谍过家家, 間諜家家酒, 스파이 패밀리"],
  ["Hunter x Hunter", "anime", "hunter x hunter, hxh, hisoka, killua, gon freecss, kurapika, chrollo, illumi zoldyck, illumi, ハンターハンター, ハンター×ハンター, 全职猎人"],
  ["Naruto", "anime", "naruto, sasuke uchiha, sasuke, kakashi, itachi uchiha, itachi, madara uchiha, obito, hinata hyuga, hinata hyuuga, gaara, shikamaru, neji hyuga, minato namikaze, jiraiya, tsunade, orochimaru, boruto, sarada uchiha, deidara akatsuki, akatsuki, ナルト, 火影忍者, 나루토"],
  ["One Piece", "anime", "luffy, roronoa zoro, zoro one piece, sanji, nico robin, trafalgar law, portgas d. ace, boa hancock, doflamingo, mihawk, kaido one piece, yamato one piece, eustass kid, uta one piece, 海贼王, 航海王"],
  ["Bleach", "anime", "bleach anime, ichigo kurosaki, rukia kuchiki, byakuya kuchiki, hitsugaya, kenpachi zaraki, sosuke aizen, aizen, gin ichimaru, grimmjow, ulquiorra, urahara, yoruichi, orihime"],
  ["Dragon Ball", "anime", "dragon ball, son goku, goku, vegeta, gohan, frieza, broly, android 18, bulma, ドラゴンボール, 七龙珠, 龙珠z, 七龍珠, 드래곤볼"],
  ["Tokyo Ghoul", "anime", "tokyo ghoul, ken kaneki, kaneki, touka kirishima, juuzou suzuya, tsukiyama"],
  ["Death Note", "anime", "death note, light yagami, l lawliet, misa amane, ryuk"],
  ["Haikyuu", "anime", "haikyuu, haikyu, oikawa, kageyama tobio, shoyo hinata, kuroo tetsurou, bokuto, akaashi, kenma kozume, tsukishima kei, atsumu miya, osamu miya, sakusa kiyoomi, ushijima, ハイキュー, 排球少年"],
  ["Blue Lock", "anime", "blue lock, isagi yoichi, yoichi isagi, nagi seishiro, rin itoshi, sae itoshi, bachira, barou shoei, reo mikage, chigiri hyoma, shidou ryusei, ブルーロック, 蓝色监狱, 藍色監獄"],
  ["Bungo Stray Dogs", "anime", "bungo stray dogs, osamu dazai, dazai osamu, chuuya nakahara, chuya nakahara, atsushi nakajima, ryunosuke akutagawa, ranpo edogawa"],
  ["Tokyo Revengers", "anime", "tokyo revengers, manjiro sano, mikey sano, ken ryuguji, keisuke baji, chifuyu matsuno, takemichi, sanzu haruchiyo, ran haitani, rindou haitani, kazutora, 東京リベンジャーズ, 东京复仇者, 東京卍復仇者"],
  ["JoJo's Bizarre Adventure", "anime", "jojo's bizarre adventure, jojo bizarre, jjba, jotaro kujo, dio brando, giorno giovanna, bruno bucciarati, josuke higashikata, yoshikage kira, kakyoin, ジョジョの奇妙な冒険, jojo的奇妙冒险, jojo的奇妙冒險"],
  ["Fullmetal Alchemist", "anime", "fullmetal alchemist, edward elric, alphonse elric, roy mustang, riza hawkeye"],
  ["Evangelion", "anime", "evangelion, asuka langley, rei ayanami, shinji ikari, kaworu nagisa, misato katsuragi, エヴァンゲリオン, 新世纪福音战士, 新世紀福音戰士, 에반게리온"],
  ["Sailor Moon", "anime", "sailor moon, usagi tsukino, tuxedo mask, セーラームーン, 美少女战士, 美少女戰士, 세일러문"],
  ["Frieren", "anime", "frieren, himmel frieren, fern frieren, 葬送のフリーレン, フリーレン, 葬送的芙莉莲, 芙莉莲, 芙莉蓮, 장송의 프리렌"],
  ["Oshi no Ko", "anime", "oshi no ko, ai hoshino, aqua hoshino, ruby hoshino, kana arima, 推しの子, 我推的孩子"],
  ["Re:Zero / KonoSuba / isekai", "anime", "re:zero, rem re zero, emilia re zero, subaru natsuki, konosuba, megumin, kazuma satou, overlord anime, albedo overlord, ainz ooal gown, rimuru tempest, tensura, mushoku tensei, eminence in shadow, sword art online, kirito, asuna yuuki, リゼロ, 从零开始的异世界生活, このすば, 为美好的世界献上祝福"],
  ["Darling in the Franxx / Kill la Kill", "anime", "darling in the franxx, zero two, kill la kill, ryuko matoi, satsuki kiryuin, ダーリン・イン・ザ・フランキス, ダリフラ, キルラキル"],
  ["Code Geass", "anime", "code geass, lelouch, コードギアス, 叛逆的鲁路修"],
  ["Berserk / Vinland Saga", "anime", "guts berserk, griffith berserk, vinland saga"],
  ["One-Punch Man / Mob Psycho", "anime", "one punch man, one-punch man, genos, garou, mob psycho, reigen arataka"],
  ["Solo Leveling", "webtoon", "solo leveling, sung jinwoo, sung jin-woo, cha hae-in, cha hae in, 俺だけレベルアップな件, 我独自升级, 我獨自升級, 나 혼자만 레벨업"],
  ["Dandadan / Kaiju No. 8 / Sakamoto Days", "anime", "dandadan, okarun, momo ayase, kaiju no. 8, kaiju no 8, soshiro hoshina, sakamoto days, nagumo yoichi"],
  ["Wind Breaker", "anime", "haruka sakura, sakura haruka, suo hayato, umemiya hajime"],
  ["Black Butler", "anime", "black butler, kuroshitsuji, sebastian michaelis, ciel phantomhive, grell sutcliff"],
  ["Ouran / shoujo classics", "anime", "ouran high school host club, fruits basket, kyo sohma, yuki sohma, inuyasha, sesshomaru, kagome higurashi, diabolik lovers, ayato sakamaki, laito sakamaki, kanato sakamaki"],
  ["Gintama", "anime", "gintama, gintoki"],
  ["Seraph of the End / Blue Exorcist", "anime", "seraph of the end, mikaela hyakuya, ferid bathory, blue exorcist, rin okumura, mephisto pheles"],
  ["Kuroko / sports anime", "anime", "kuroko no basket, aomine daiki, kise ryota, akashi seijuro, yuri on ice, viktor nikiforov, free! iwatobi"],
  ["Classroom of the Elite", "anime", "classroom of the elite, ayanokoji, kiyotaka ayanokoji, ようこそ実力至上主義の教室へ, 实力至上主义的教室, 實力至上主義的教室"],
  ["High School DxD", "anime", "high school dxd, highschool dxd, rias gremory, akeno himejima, koneko toujou, koneko tojo, issei hyoudou, asia argento, xenovia quarta, kuoh academy, ハイスクールd×d, 恶魔高校"],
  ["Vampire Knight", "anime", "kaname kuran, zero kiryu, yuki cross"],
  ["Hellsing / Castlevania", "anime", "hellsing, alucard, seras victoria, castlevania, trevor belmont"],
  ["Trigun", "anime", "trigun, vash the stampede, wolfwood"],
  ["Ghibli", "anime", "studio ghibli, howl's moving castle, howl pendragon, totoro, ジブリ, 吉卜力"],
  ["Steins;Gate / Dungeon Meshi / misc anime", "anime", "steins;gate, steins gate, kurisu makise, dungeon meshi, delicious in dungeon, laios touden, kakegurui, yumeko jabami, hanako-kun, hanako kun, tsukasa yugi, my dress-up darling, marin kitagawa, rent-a-girlfriend, chizuru mizuhara, bocchi the rock, kaguya-sama, mashle, gachiakuta, hell's paradise, gabimaru, dr. stone, noragami, banana fish, ash lynx"],
  ["Korean webtoons / BL manhwa", "webtoon", "tower of god, omniscient reader, kim dokja, eleceed, killing stalking, oh sangwoo, yoon bum, jinx manhwa, joo jaekyung, painter of the night, bj alex, lore olympus"],
  ["Marvel", "western", "mcu, spider-man, spiderman, peter parker, miles morales, gwen stacy, spider-gwen, miguel o'hara, hobie brown, deadpool, wade wilson, logan howlett, loki laufeyson, thor odinson, tony stark, steve rogers, captain america, bucky barnes, winter soldier, natasha romanoff, wanda maximoff, scarlet witch, venom marvel, eddie brock, doctor strange, stephen strange, killmonger, bruce banner, clint barton, yelena belova, moon knight, magneto, charles xavier, gambit x-men, rogue x-men, x-men, jean grey, emma frost, matt murdock, frank castle, ghost rider, carol danvers, captain marvel, kang the conqueror, ultron, she-hulk, 漫威, マーベル"],
  ["DC", "western", "dc comics, batman, bruce wayne, harley quinn, clark kent, wonder woman, diana prince, catwoman, selina kyle, nightwing, dick grayson, jason todd, damian wayne, riddler, scarecrow dc, lex luthor, aquaman, barry allen, john constantine, starfire, beast boy, raven teen titans, teen titans, power girl, deathstroke, slade wilson, ra's al ghul, talia al ghul"],
  ["The Boys / Invincible", "western", "the boys, homelander, billy butcher, omni-man, omniman, mark grayson, atom eve, nolan grayson"],
  ["Star Wars", "western", "star wars, darth vader, anakin skywalker, kylo ren, ben solo, luke skywalker, leia organa, han solo, obi-wan, obi wan, din djarin, mandalorian, boba fett, ahsoka, darth maul, palpatine, padme amidala, cassian andor, captain rex, clone trooper, cal kestis, ezra bridger, スター・ウォーズ, 星球大战, 星際大戰"],
  ["Harry Potter", "western", "harry potter, hogwarts, draco malfoy, hermione granger, ron weasley, severus snape, snape, tom riddle, voldemort, sirius black, remus lupin, regulus black, james potter, bellatrix lestrange, lucius malfoy, cedric diggory, fred weasley, george weasley, luna lovegood, dumbledore, grindelwald, theodore nott, mattheo riddle, lorenzo berkshire, enzo berkshire, blaise zabini, pansy parkinson, slytherin, gryffindor, ハリー・ポッター, 哈利波特, 哈利·波特"],
  ["Lord of the Rings", "western", "lord of the rings, lotr, legolas, aragorn, gandalf, frodo, sauron, galadriel, thranduil, thorin oakenshield, rings of power, halbrand"],
  ["Game of Thrones / House of the Dragon", "western", "game of thrones, house of the dragon, daenerys, jon snow, aemond targaryen, aemond, daemon targaryen, aegon targaryen, rhaenyra, alicent hightower, cersei lannister, jaime lannister, tyrion, arya stark, sansa stark, ramsay bolton, khal drogo, criston cole, targaryen"],
  ["Twilight", "western", "twilight saga, edward cullen, jacob black, bella swan, jasper hale, alice cullen, rosalie hale, aro volturi, alec volturi, volturi"],
  ["Stranger Things", "western", "stranger things, eddie munson, steve harrington, billy hargrove, jim hopper, vecna, henry creel, nancy wheeler, robin buckley"],
  ["Supernatural (TV)", "western", "dean winchester, sam winchester, castiel"],
  ["Wednesday / Addams Family", "western", "wednesday addams, enid sinclair, xavier thorpe, tyler galpin, addams family, morticia addams"],
  ["The Vampire Diaries", "western", "vampire diaries, damon salvatore, stefan salvatore, elena gilbert, klaus mikaelson, elijah mikaelson, kol mikaelson, the originals"],
  ["Percy Jackson / Hunger Games", "western", "percy jackson, annabeth chase, nico di angelo, luke castellan, hunger games, katniss everdeen, peeta mellark, finnick odair, coriolanus snow"],
  ["Avatar: The Last Airbender", "western", "avatar the last airbender, last airbender, legend of korra, zuko, katara, sokka, toph beifong, azula, uncle iroh"],
  ["Disney / Pixar / DreamWorks", "western", "frozen elsa, elsa frozen, arendelle, queen elsa, elsa of arendelle, flynn rider, aladdin, maleficent, zootopia, judy hopps, nick wilde, toy story, the owl house, owl house, luz noceda, amity blight, gravity falls, bill cipher, dipper pines, steven universe, princess bubblegum, she-ra, catra, black hat villainous, shrek, puss in boots, kung fu panda, how to train your dragon, ディズニー, 迪士尼"],
  ["Cartoons (other)", "western", "spongebob, scooby-doo, looney tunes, lola bunny, the simpsons, rick and morty, rick sanchez, bojack horseman, invader zim, powerpuff girls, my little pony, twilight sparkle, rainbow dash, fluttershy, pinkie pie, teenage mutant ninja turtles, tmnt, optimus prime, megatron, sonic the hedgehog, shadow the hedgehog, ben 10, danny phantom, kim possible"],
  ["Horror icons & creepypasta", "western", "ghostface, michael myers, jason voorhees, freddy krueger, leatherface, hannibal lecter, jigsaw saw, art the clown, terrifier, m3gan, slender man, slenderman, jeff the killer, eyeless jack, ticci toby, laughing jack, creepypasta, siren head, scp foundation, scp-096, scp-049, scp-106, scp-682, xenomorph, predator yautja, yautja, godzilla"],
  ["Breaking Bad / Peaky Blinders / TV dramas", "western", "walter white, jesse pinkman, saul goodman, peaky blinders, thomas shelby, tommy shelby, alfie solomons, daryl dixon, negan, rick grimes, euphoria hbo, nate jacobs, squid game, bridgerton, anthony bridgerton, interview with the vampire, lestat, sherlock holmes, doctor who, star trek, paul atreides, feyd-rautha"],
  ["Film icons", "western", "john wick, james bond, jack sparrow, pirates of the caribbean, terminator, patrick bateman, american psycho, tyler durden, arthur fleck, joker 2019, wicked musical, elphaba"],
  ["Hololive / Nijisanji (VTubers)", "vtuber", "hololive, nijisanji, vshojo, gawr gura, mori calliope, houshou marine, usada pekora, hoshimachi suisei, shirakami fubuki, nekomata okayu, inugami korone, ookami mio, minato aqua, takanashi kiara, ninomae ina'nis, amelia watson, ouro kronii, nanashi mumei, hakos baelz, ceres fauna, koseki bijou, fuwamoco, ironmouse, vox akuma, mysta rias, ike eveland, luca kaneshiro, shu yamino, ホロライブ, にじさんじ"],
];

/** The franchises whose main cast is, or is often drawn as, under 18 (the census's list). */
const SCHOOL_AGE: ReadonlySet<string> = new Set([
  "Attack on Titan",
  "Avatar: The Last Airbender",
  "Black Butler",
  "Bleach",
  "Blue Archive",
  "Blue Lock",
  "Cartoons (other)",
  "Chainsaw Man",
  "Classroom of the Elite",
  "Code Geass",
  "Dandadan / Kaiju No. 8 / Sakamoto Days",
  "Danganronpa",
  "Darling in the Franxx / Kill la Kill",
  "Demon Slayer",
  "Disney / Pixar / DreamWorks",
  "Doki Doki Literature Club",
  "Evangelion",
  "Fate series",
  "Five Nights at Freddy's",
  "Frieren",
  "Haikyuu",
  "Harry Potter",
  "High School DxD",
  "Hunter x Hunter",
  "Jujutsu Kaisen",
  "Kingdom Hearts",
  "Kuroko / sports anime",
  "Minecraft / Roblox / Fortnite",
  "Murder Drones / Glitch",
  "My Hero Academia",
  "Naruto",
  "Omori",
  "Oshi no Ko",
  "Ouran / shoujo classics",
  "Percy Jackson / Hunger Games",
  "Persona",
  "Pokémon",
  "Poppy Playtime / indie horror",
  "RWBY",
  "Sailor Moon",
  "Seraph of the End / Blue Exorcist",
  "Spy x Family",
  "Stranger Things",
  "Tokyo Revengers",
  "Touhou Project",
  "Umamusume: Pretty Derby",
  "Undertale / Deltarune",
  "Vampire Knight",
  "Vocaloid",
  "Wednesday / Addams Family",
  "Wind Breaker",
]);

export type FranchiseHit = {
  franchise: string;
  kind: FranchiseKind;
  /** The words that matched, as written. */
  matched: string;
  /** Which part of the character said it: name, bio, appearance and so on. */
  field: string;
  /** Its main cast is, or is often drawn as, under 18. */
  school_age: boolean;
};

export const FRANCHISE_COUNT = FRANCHISES.length;

/**
 * The titles a name inside the franchise's own doesn't give away ("genshin" in Genshin Impact does): titles in other
 * languages, sequels, acronyms, and each title of a row that holds several. With the CJK names (the table's are its
 * titles), they count only in IDENTITY_FIELDS.
 */
const TITLES: ReadonlySet<string> = new Set([
  // Games.
  "fate/grand order", "fate grand order", "fgo", "fate/stay night", "fate stay night", "splatoon", "animal crossing", "dark souls",
  "bloodborne", "sekiro", "mystic messenger", "tears of themis", "ensemble stars", "twisted wonderland", "twisted-wonderland",
  "identity v", "project sekai", "limbus company", "lobotomy corporation", "library of ruina", "cookie run", "helltaker",
  "punishing gray raven", "reverse: 1999", "reverse 1999", "girls' frontline", "girls frontline", "uma musume", "idolmaster",
  "wuwa", "ddlc", "fnaf", "bg3", "baldurs gate", "tlou", "persona 5", "persona 4", "persona 3", "hades ii", "hades 2",
  "nier automata", "nier: automata", "love & deepspace",
  // Anime, manga and webtoons.
  "jjk", "hxh", "bnha", "boku no hero", "kimetsu no yaiba", "shingeki no kyojin", "jojo bizarre", "jjba", "kuroshitsuji",
  "highschool dxd", "bleach anime", "boruto", "tensura", "inuyasha", "ouran high school host club", "fruits basket",
  "diabolik lovers", "kuroko no basket", "yuri on ice", "free! iwatobi", "delicious in dungeon", "kakegurui", "hanako-kun",
  "hanako kun", "my dress-up darling", "rent-a-girlfriend", "bocchi the rock", "kaguya-sama", "mashle", "gachiakuta",
  "hell's paradise", "dr. stone", "noragami", "banana fish", "howl's moving castle", "totoro", "tower of god",
  "omniscient reader", "eleceed", "killing stalking", "jinx manhwa", "painter of the night", "bj alex", "lore olympus",
  "amazing digital circus", "digital circus", "dandy's world", "vshojo",
  // Film, TV and comics.
  "mcu", "x-men", "dc comics", "teen titans", "lotr", "rings of power", "twilight saga", "legend of korra", "zootopia",
  "toy story", "the owl house", "owl house", "gravity falls", "steven universe", "kung fu panda", "how to train your dragon",
  "shrek", "looney tunes", "the simpsons", "rick and morty", "bojack horseman", "invader zim", "powerpuff girls",
  "my little pony", "teenage mutant ninja turtles", "tmnt", "ben 10", "danny phantom", "kim possible", "spongebob",
  "scooby-doo", "sonic the hedgehog", "pirates of the caribbean", "american psycho", "wicked musical", "terminator",
  "joker 2019", "terrifier", "m3gan", "scp foundation", "godzilla", "euphoria hbo", "squid game", "bridgerton",
  "interview with the vampire", "doctor who", "star trek", "haikyu", "studio ghibli", "umamusume",
  // Names a bio uses as a figure of speech ("a real Wonder Woman at work", "suave as James Bond"), and the public-domain
  // ones a film made its own: like a title, they count only as who a character is.
  "wonder woman", "batman", "spider-man", "spiderman", "deadpool", "catwoman", "aquaman", "captain america", "james bond",
  "sherlock holmes", "puss in boots", "aladdin",
]);

/** Where a title counts: the fields that say who a character is and how they look, not what they like. */
export const IDENTITY_FIELDS: ReadonlySet<string> = new Set(["name", "appearance", "look", "role", "props", "outfit", "scene", "kind", "costume"]);

/** Chinese, Japanese and Korean script: kana, CJK ideographs and Hangul. */
const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/u;
const WORD = "[\\p{L}\\p{M}\\p{N}_]";

type Pattern = { franchise: string; kind: FranchiseKind; cast: RegExp | null; titles: RegExp | null };
let compiled: Pattern[] | null = null;

/** Lower case, accents and punctuation gone: "Pokémon" and "pokemon", "Re:Zero" and "re zero" read the same. */
const bare = (s: string): string =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Whether a name is one of the franchise's titles rather than a character or a place. */
const isTitle = (name: string, franchise: string): boolean => CJK.test(name) || TITLES.has(name) || ` ${bare(franchise)} `.includes(` ${bare(name)} `);

/** One pattern of names, longest first: Latin ones on word boundaries and any spacing, CJK ones anywhere. */
function pattern(names: readonly string[]): RegExp | null {
  if (!names.length) return null;
  const sorted = [...names].sort((a, b) => b.length - a.length);
  const latin = sorted.filter((n) => !CJK.test(n)).map((n) => escapeRegExp(n).replace(/ +/g, "[\\s_-]+"));
  const cjk = sorted.filter((n) => CJK.test(n)).map(escapeRegExp);
  const alternatives = [...(latin.length ? [`(?<!${WORD})(?:${latin.join("|")})(?!${WORD})`] : []), ...(cjk.length ? [`(?:${cjk.join("|")})`] : [])];
  return new RegExp(alternatives.join("|"), "iu");
}

/** Each franchise's two patterns: its characters and places (anywhere), and its titles (only in IDENTITY_FIELDS). */
function patterns(): Pattern[] {
  return (compiled ??= FRANCHISES.map(([franchise, kind, aliases]) => {
    const names = [...new Set(aliases.split(",").map((a) => a.trim()).filter(Boolean))];
    return { franchise, kind, cast: pattern(names.filter((n) => !isTitle(n, franchise))), titles: pattern(names.filter((n) => isTitle(n, franchise))) };
  }));
}

/** Every string in a value (a field, a list, the extras), a few levels down. */
function strings(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 4 || out.length >= 200) return out;
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out, depth + 1);
  else if (value && typeof value === "object") for (const v of Object.values(value)) strings(v, out, depth + 1);
  return out;
}

/** Full-width letters folded, and curly apostrophes made straight ("kal’tsit"). */
const plain = (s: string): string => s.normalize("NFKC").replace(/[‘’ʼ]/g, "'");

/**
 * Each franchise a character's words name, once, with the first field (in the order given) that names it. Fields are
 * named however the caller likes (name, bio, appearance, extras…), and a title counts only in IDENTITY_FIELDS; [] for an
 * original.
 */
export function franchiseHits(fields: Record<string, unknown>): FranchiseHit[] {
  const hits = new Map<string, FranchiseHit>();
  for (const [field, value] of Object.entries(fields)) {
    const identity = IDENTITY_FIELDS.has(field);
    for (const text of strings(value).map(plain)) {
      for (const p of patterns()) {
        if (hits.has(p.franchise)) continue;
        const m = p.cast?.exec(text) ?? (identity ? p.titles?.exec(text) : null);
        if (m) hits.set(p.franchise, { franchise: p.franchise, kind: p.kind, matched: m[0], field, school_age: SCHOOL_AGE.has(p.franchise) });
      }
    }
  }
  return [...hits.values()];
}

/** A field as a person reads it: "extras" is their profile. */
const FIELD_WORDS: Record<string, string> = { extras: "profile", kit: "profile", soul: "private notes" };
const fieldSays = (field: string): string => {
  const word = FIELD_WORDS[field] ?? field;
  return `${word} ${word.endsWith("s") && word !== "bio" ? "say" : "says"}`;
};

/** A character sheet's words, by field: what franchiseHits reads for a character. */
export function sheetFields(sheet: {
  name?: unknown;
  bio?: unknown;
  appearance?: unknown;
  voice?: unknown;
  traits?: unknown;
  want?: unknown;
  dealbreaker?: unknown;
  extras?: unknown;
}): Record<string, unknown> {
  return { name: sheet.name, bio: sheet.bio, appearance: sheet.appearance, voice: sheet.voice, traits: sheet.traits, want: sheet.want, dealbreaker: sheet.dealbreaker, extras: sheet.extras };
}

/** The warning on a person's character: what it reads like, and that the show is originals. Null for an original. */
export function franchiseWarning(hits: readonly FranchiseHit[]): string | null {
  const h = hits[0];
  if (!h) return null;
  const more = hits.length > 1 ? ` (and ${hits.length - 1} more)` : "";
  return `Its ${fieldSays(h.field)} "${h.matched}", which reads like ${h.franchise}${more}. Botchelor is a show of original characters: a name and a story of their own get further than a copy.`;
}

/** The refusal for Botchelor's own characters and After Dark's. Null for an original. */
export function franchiseRefusal(hits: readonly FranchiseHit[], where = "Botchelor"): string | null {
  const h = hits[0];
  if (!h) return null;
  return `${where} keeps to original characters: the ${fieldSays(h.field)} "${h.matched}", which reads like ${h.franchise}. Give them a name and a story of their own.`;
}

/** The first franchise a sheet's words name, as the refusal for one of ours; null for an original. */
export function sheetRefusal(sheet: Parameters<typeof sheetFields>[0], where = "Botchelor"): string | null {
  return franchiseRefusal(franchiseHits(sheetFields(sheet)), where);
}
