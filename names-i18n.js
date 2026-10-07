// Arabic, Russian and Ukrainian names for places already in the place lists. One per line:
//   English name as the place lists spell it|name;name;...
// Cyrillic names are stems: up to 4 more letters may follow, for case endings (Киев -> Киеве, Київ -> Києві,
// Брянск -> Брянской), so give each distinct stem (Київ and Києв). A city followed by "области", "регион",
// "край" or "області" picks its province. Region lines (Kharkiv Region) take the adjective and -щина forms. Arabic names may carry an attached و ف ب ل ك in front ("بغزة").
// Spelling variants of Arabic letters (أ إ آ ا, ة ه, ى ي) are matched either way.
// Leave out names that are common words ("Орел" = eagle, "صور" = pictures, "عمان" = Amman and Oman).
const I18N_NAMES = `
Kyiv|Киев;Київ;Києв;كييف;كيف
Kharkiv|Харьков;Харків;Харков;خاركيف
Odesa|Одесс;Одес;أوديسا
Dnipro|Днепр;Дніпр;دنيبرو
Zaporizhzhia|Запорож;Запоріж;زابوريجيا
Kherson|Херсон;خيرسون
Mykolaiv|Николаев;Миколаїв;Миколаєв;ميكولايف
Lviv|Львов;Львів;لفيف
Sumy|Сумы;Сумах;Суми
Pryluky|Прилук
Oleksandriia|Александри;Олександрі
Chernihiv Region|Черниговск;Чернігівськ;Чернігівщин;Черниговщин
Kharkiv Region|Харьковск;Харківськ;Харківщин;Харьковщин
Sumy Region|Сумск;Сумськ;Сумщин
Poltava Region|Полтавск;Полтавськ;Полтавщин
Kyiv Region|Киевск;Київськ;Київщин;Киевщин
Odessa Region|Одесск;Одеськ;Одещин
Zaporizhzhia Region|Запорожск;Запорізьк
Dnipropetrovsk Region|Днепропетровск;Дніпропетровськ;Дніпропетровщин;Днепропетровщин
Donetsk Region|Донеччин;Донетчин
Mykolaiv Region|Николаевск;Миколаївськ;Миколаївщин
Kursk Region|Курщин
Belgorod Region|Белгородщин;Бєлгородщин
Bryansk Region|Брянщин
Chernihiv|Чернигов;Чернігів;Чернігов
Poltava|Полтав
Kremenchuk|Кременчуг;Кременчук
Kryvyi Rih|Кривой Рог;Кривом Рог;Кривого Рог;Кривий Ріг;Кривому Роз;Кривого Рог
Vinnytsia|Винниц;Вінниц
Zhytomyr|Житомир
Cherkasy|Черкасс;Черкас
Kramatorsk|Краматорск;Краматорськ
Sloviansk|Славянск
Pokrovsk|Покровск;Покровськ
Kostiantynivka|Константиновк;Костянтинівк
Donetsk|Донецк;Донецьк;دونيتسك
Luhansk|Луганск;Луганськ;لوغانسك
Mariupol|Мариупол;Маріупол;ماريوبول
Melitopol|Мелитопол;Мелітопол
Sevastopol|Севастопол;سيفاستوبول
Crimea|Крым;Крим;القرم
Moscow|Москв;موسكو
Saint Petersburg|Петербург;Санкт-Петербург
Belgorod|Белгород;Бєлгород;بيلغورود
Kursk|Курск;Курськ;كورسك
Bryansk|Брянск;Брянськ;بريانسك
Voronezh|Воронеж
Rostov-on-Don|Ростов
Krasnodar|Краснодар
Novorossiysk|Новороссийск;Новоросійськ;نوفوروسيسك
Tuapse|Туапсе
Sochi|Сочи;Сочі;سوتشي
Ryazan|Рязан
Tula|Тула;Туле;Тулы
Kaluga|Калуг
Lipetsk|Липецк
Tambov|Тамбов
Saratov|Саратов
Engels|Энгельс;Енгельс
Volgograd|Волгоград
Samara|Самар
Syzran|Сызран
Kazan|Казан
Nizhny Novgorod|Нижний Новгород;Нижнем Новгород;Нижнего Новгород
Yaroslavl|Ярославл
Smolensk|Смоленск
Tver|Твер
Pskov|Псков
Kaliningrad|Калининград
Ufa|Уфа;Уфе;Уфы
Perm|Перм
Orenburg|Оренбург
Taganrog|Таганрог
Yeysk|Ейск
Ust-Luga|Усть-Луг
Dagestan|Дагестан
Chechnya|Чечн
Minsk|Минск;Мінськ
Ukraine|Украин;Україн;أوكرانيا
Russia|Росси;Росі;روسيا
Belarus|Беларус;Білорус
Israel|Израил;Ізраїл;إسرائيل
Iran|Иран;Іран;إيران
Iraq|Ирак;Ірак;العراق
Syria|Сири;Сирі;سوريا;سورية
Lebanon|Ливан;Ліван;لبنان
Yemen|Йемен;Ємен;اليمن
Sudan|Судан;السودان
Saudi Arabia|Саудовск;السعودية
Türkiye|Турци;Туреччин;تركيا
Palestine|Палестин;فلسطين
Gaza|Газа;Газе;Газы;Газі;Газу;غزة;قطاع غزة
Gaza City|مدينة غزة
Khan Younis|خان يونس
Rafah|Рафах;رفح
Deir al-Balah|دير البلح
Jabalia|جباليا
Nuseirat|النصيرات
Jenin|Дженин;جنين
Tulkarm|طولكرم
Nablus|نابلس
Ramallah|رام الله
Hebron|الخليل
West Bank|Западный берег;Западном берег;Западного берег;Західн;الضفة الغربية
Jerusalem|Иерусалим;Єрусалим;القدس
Tel Aviv|Тель-Авив;Тель-Авів;تل أبيب
Haifa|Хайф;حيفا
Eilat|Эйлат;Ейлат;إيلات
Ashkelon|Ашкелон;عسقلان
Beirut|Бейрут;بيروت
Dahiyeh|الضاحية الجنوبية
Sidon|صيدا
Nabatieh|النبطية
Baalbek|بعلبك
Bekaa|البقاع
South Lebanon|جنوب لبنان
Damascus|Дамаск;دمشق
Aleppo|Алеппо;حلب
Homs|Хомс;حمص
Hama|حماة
Idlib|Идлиб;إدلب
Latakia|Латаки;اللاذقية
Tartus|Тартус;طرطوس
Deir ez-Zor|Дейр-эз-Зор;دير الزور
Raqqa|Ракк;الرقة
Daraa|درعا
Sweida|السويداء
Baghdad|Багдад;بغداد
Erbil|Эрбил;أربيل
Mosul|Мосул;الموصل
Basra|Басра;Басре;البصرة
Kirkuk|كركوك
Tehran|Тегеран;طهران
Isfahan|Исфахан;أصفهان
Sanaa|صنعاء
Aden|Аден;عدن
Hodeidah|Ходейд;الحديدة
Marib|مأرب
Taiz|تعز
Saada|صعدة
Riyadh|Эр-Рияд;الرياض
Jeddah|جدة
Dubai|Дубай;دبي
Abu Dhabi|Абу-Даби;أبوظبي;أبو ظبي
Doha|Доха;الدوحة
Kuwait City|مدينة الكويت
Khartoum|Хартум;الخرطوم
Omdurman|أم درمان
El Fasher|Эль-Фашер;الفاشر
Port Sudan|Порт-Судан;بورتسودان;بورت سودان
Darfur|Дарфур;دارفور
Kordofan|كردفان
Tripoli|طرابلس
Benghazi|بنغازي
Cairo|Каир;القاهرة
Sinai|Синай;سيناء
Mogadishu|Могадишо;مقديشو
`;
