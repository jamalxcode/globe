// Places a headline can be pinned to. One per line:
//   Name;Alias;Alias|Country|lat|lng|r
// The trailing "r" marks a region (drawn as a 100 km disc); without it the place is a city (a dot).
// Names match case-sensitively on whole words, so "Tyre" (Lebanon) never matches "tyre".
// Countries come from the map itself (see COUNTRY_ALIASES below), so they aren't listed here.
// Leave out names that are common words or people's names (Nice, Mobile, Jordan's cities are fine).
const PLACE_LINES = `
Kyiv;Kiev;Ukrainian capital;Ukraine's capital;Ukraine’s capital|Ukraine|50.45|30.52
Kharkiv;Kharkov|Ukraine|49.99|36.23
Odesa;Odessa|Ukraine|46.48|30.72
Yuzhny;Yuzhny Port;Yuzhne;Pivdennyi;Pivdennyi Port|Ukraine|46.62|31.10
Dnipro;Dnipropetrovsk|Ukraine|48.46|35.05
Zaporizhzhia;Zaporizhia;Zaporozhye|Ukraine|47.84|35.14
Kherson|Ukraine|46.64|32.62
Mykolaiv;Mykolayiv|Ukraine|46.98|31.99
Lviv|Ukraine|49.84|24.03
Sumy|Ukraine|50.91|34.80
Chernihiv|Ukraine|51.50|31.29
Poltava|Ukraine|49.59|34.55
Kremenchuk|Ukraine|49.07|33.42
Pryluky;Priluki|Ukraine|50.59|32.39
Oleksandriia;Oleksandriya;Aleksandriya|Ukraine|48.67|33.10
Kryvyi Rih;Kryvyi Rig;Krivoy Rog|Ukraine|47.91|33.39
Nikopol|Ukraine|47.57|34.40
Pavlohrad|Ukraine|48.53|35.87
Vinnytsia|Ukraine|49.23|28.47
Zhytomyr|Ukraine|50.25|28.66
Cherkasy|Ukraine|49.44|32.06
Kropyvnytskyi|Ukraine|48.51|32.26
Khmelnytskyi|Ukraine|49.42|26.99
Starokostiantyniv|Ukraine|49.76|27.21
Ternopil|Ukraine|49.55|25.59
Rivne|Ukraine|50.62|26.25
Lutsk|Ukraine|50.75|25.33
Ivano-Frankivsk|Ukraine|48.92|24.71
Uzhhorod|Ukraine|48.62|22.29
Bila Tserkva|Ukraine|49.80|30.11
Izmail|Ukraine|45.35|28.84
Chornomorsk|Ukraine|46.30|30.66
Kramatorsk|Ukraine|48.74|37.58
Sloviansk;Slovyansk|Ukraine|48.85|37.60
Kostiantynivka|Ukraine|48.53|37.71
Pokrovsk|Ukraine|48.28|37.18
Myrnohrad|Ukraine|48.30|37.26
Chasiv Yar|Ukraine|48.59|37.84
Toretsk|Ukraine|48.40|37.85
Bakhmut|Ukraine|48.60|38.00
Avdiivka|Ukraine|48.14|37.74
Kupiansk;Kupyansk|Ukraine|49.71|37.62
Lyman|Ukraine|48.99|37.80
Huliaipole|Ukraine|47.66|36.26
Orikhiv|Ukraine|47.57|35.79
Siversk|Ukraine|48.87|38.10
Vovchansk|Ukraine|50.29|36.94
Donetsk|Ukraine|48.02|37.80
Horlivka|Ukraine|48.30|38.05
Mariupol|Ukraine|47.10|37.55
Luhansk;Lugansk|Ukraine|48.57|39.31
Melitopol|Ukraine|46.85|35.37
Berdiansk;Berdyansk|Ukraine|46.76|36.80
Enerhodar|Ukraine|47.50|34.66
Tokmak|Ukraine|47.25|35.71
Sevastopol|Ukraine|44.62|33.53
Simferopol|Ukraine|44.95|34.10
Feodosia|Ukraine|45.03|35.38
Kerch;Crimean Bridge;Kerch Bridge|Ukraine|45.36|36.47
Dzhankoi|Ukraine|45.71|34.39
Saky|Ukraine|45.13|33.60
Yevpatoria|Ukraine|45.19|33.37
Crimea|Ukraine|45.30|34.40|r
Donbas;Donbass|Ukraine|48.30|38.30|r
Moscow;Russian capital;Russia's capital;Russia’s capital|Russia|55.76|37.62
Saint Petersburg;St. Petersburg;St Petersburg|Russia|59.94|30.31
Belgorod|Russia|50.60|36.59
Kursk|Russia|51.73|36.19
Bryansk|Russia|53.24|34.36
Voronezh|Russia|51.66|39.20
Rostov-on-Don;Rostov|Russia|47.24|39.71
Taganrog|Russia|47.22|38.90
Krasnodar|Russia|45.04|38.98
Novorossiysk|Russia|44.72|37.77
Tuapse|Russia|44.10|39.08
Sochi|Russia|43.60|39.73
Yeysk|Russia|46.71|38.27
Ryazan|Russia|54.63|39.74
Tula|Russia|54.19|37.62
Kaluga|Russia|54.51|36.26
Oryol;Orel|Russia|52.97|36.07
Lipetsk|Russia|52.61|39.59
Tambov|Russia|52.72|41.45
Saratov|Russia|51.53|46.03
Engels|Russia|51.50|46.12
Volgograd|Russia|48.71|44.51
Samara|Russia|53.20|50.15
Syzran|Russia|53.16|48.47
Kazan|Russia|55.79|49.12
Yelabuga;Alabuga|Russia|55.76|52.05
Nizhny Novgorod|Russia|56.33|44.00
Yaroslavl|Russia|57.63|39.87
Smolensk|Russia|54.78|32.05
Tver|Russia|56.86|35.90
Pskov|Russia|57.82|28.33
Kaliningrad|Russia|54.71|20.51
Murmansk|Russia|68.97|33.08
Olenya|Russia|68.15|33.46
Novoshakhtinsk|Russia|47.76|39.93
Millerovo|Russia|48.92|40.39
Morozovsk|Russia|48.35|41.83
Primorsko-Akhtarsk|Russia|46.05|38.17
Ufa|Russia|54.74|55.97
Perm|Russia|58.01|56.25
Orenburg|Russia|51.77|55.10
Cheboksary|Russia|56.15|47.25
Makhachkala|Russia|42.98|47.50
Grozny|Russia|43.32|45.69
Ust-Luga|Russia|59.68|28.40
Dagestan|Russia|42.80|47.00|r
Chechnya|Russia|43.40|45.70|r
Minsk|Belarus|53.90|27.56
Chisinau|Moldova|47.01|28.86
Tiraspol;Transnistria|Moldova|46.84|29.63
Rzeszow;Rzeszów|Poland|50.04|22.00
Warsaw|Poland|52.23|21.01
Vilnius|Lithuania|54.69|25.28
Riga|Latvia|56.95|24.11
Tallinn|Estonia|59.44|24.75
Constanta;Constanța|Romania|44.18|28.65
Tbilisi|Georgia|41.72|44.79
Yerevan|Armenia|40.18|44.51
Baku|Azerbaijan|40.41|49.87
Nagorno-Karabakh;Karabakh|Azerbaijan|39.82|46.75|r
Tel Aviv|Israel|32.09|34.78
Jerusalem|Israel|31.77|35.21
Haifa|Israel|32.79|34.99
Eilat|Israel|29.56|34.95
Ashkelon|Israel|31.67|34.57
Ashdod|Israel|31.80|34.65
Sderot|Israel|31.52|34.60
Beersheba;Be'er Sheva;Beer Sheva|Israel|31.25|34.79
Netanya|Israel|32.33|34.86
Herzliya|Israel|32.16|34.84
Ramat Gan|Israel|32.08|34.82
Petah Tikva|Israel|32.09|34.89
Rishon LeZion;Rishon Lezion|Israel|31.97|34.79
Nahariya|Israel|33.01|35.10
Kiryat Shmona|Israel|33.21|35.57
Metula|Israel|33.28|35.58
Safed;Tzfat|Israel|32.96|35.50
Tiberias|Israel|32.79|35.53
Dimona|Israel|31.07|35.03
Nevatim|Israel|31.21|35.01
Ben Gurion Airport|Israel|32.01|34.89
Golan Heights;Golan|Israel|33.00|35.75|r
Galilee|Israel|32.90|35.40|r
Negev|Israel|30.80|34.80|r
Gaza City|Palestine|31.50|34.47
Gaza;Gaza Strip|Palestine|31.42|34.38
Khan Younis;Khan Yunis|Palestine|31.35|34.31
Rafah|Palestine|31.30|34.25
Deir al-Balah;Deir el-Balah|Palestine|31.42|34.35
Jabalia;Jabaliya|Palestine|31.53|34.48
Beit Lahia|Palestine|31.55|34.50
Beit Hanoun|Palestine|31.54|34.54
Nuseirat|Palestine|31.45|34.39
Bureij|Palestine|31.44|34.40
Maghazi|Palestine|31.42|34.38
Mawasi;al-Mawasi|Palestine|31.34|34.27
Shujaiya;Shejaiya|Palestine|31.50|34.48
Zeitoun|Palestine|31.49|34.45
Jenin|Palestine|32.46|35.30
Tulkarm|Palestine|32.31|35.03
Nablus|Palestine|32.22|35.26
Ramallah|Palestine|31.90|35.20
Hebron|Palestine|31.53|35.10
Bethlehem|Palestine|31.70|35.20
Jericho|Palestine|31.86|35.46
Qalqilya|Palestine|32.19|34.97
Tubas|Palestine|32.32|35.37
West Bank|Palestine|31.95|35.25|r
Beirut;Lebanese capital;Lebanon's capital;Lebanon’s capital|Lebanon|33.89|35.50
Dahiyeh;Dahieh;Dahiya|Lebanon|33.85|35.51
Tyre|Lebanon|33.27|35.20
Sidon;Saida|Lebanon|33.56|35.37
Nabatieh;Nabatiyeh|Lebanon|33.38|35.48
Baalbek|Lebanon|34.01|36.21
Hermel|Lebanon|34.39|36.38
Marjayoun|Lebanon|33.36|35.59
Bint Jbeil|Lebanon|33.12|35.43
Khiam|Lebanon|33.33|35.61
Naqoura|Lebanon|33.12|35.14
Bekaa;Beqaa|Lebanon|33.85|35.90|r
South Lebanon;southern Lebanon|Lebanon|33.25|35.40|r
Damascus;Syrian capital;Syria's capital;Syria’s capital|Syria|33.51|36.28
Aleppo|Syria|36.20|37.13
Homs|Syria|34.73|36.71
Hama|Syria|35.13|36.75
Idlib|Syria|35.93|36.63
Latakia|Syria|35.52|35.79
Tartus|Syria|34.89|35.89
Deir ez-Zor;Deir Ezzor;Deir al-Zour;Deir ez Zor|Syria|35.34|40.14
Raqqa|Syria|35.95|39.01
Hasakah;Al-Hasakah|Syria|36.50|40.75
Qamishli|Syria|37.05|41.22
Palmyra|Syria|34.55|38.27
Daraa;Deraa|Syria|32.62|36.10
Quneitra|Syria|33.13|35.82
Sweida;Suwayda|Syria|32.71|36.57
Manbij|Syria|36.53|37.95
Kobani|Syria|36.89|38.35
Afrin|Syria|36.51|36.87
Abu Kamal;Al-Bukamal;Albu Kamal|Syria|34.45|40.92
Mayadin|Syria|35.02|40.45
Al-Tanf;Tanf|Syria|33.50|38.62
Baghdad;Iraqi capital;Iraq's capital;Iraq’s capital|Iraq|33.32|44.37
Erbil;Irbil|Iraq|36.19|44.01
Mosul|Iraq|36.34|43.12
Basra|Iraq|30.51|47.78
Kirkuk|Iraq|35.47|44.39
Sulaymaniyah;Sulaimaniyah|Iraq|35.56|45.44
Fallujah|Iraq|33.35|43.78
Ramadi|Iraq|33.43|43.30
Tikrit|Iraq|34.61|43.68
Samarra|Iraq|34.20|43.87
Najaf|Iraq|32.00|44.34
Karbala|Iraq|32.62|44.02
Ain al-Asad;Ain al-Assad|Iraq|33.80|42.44
Jurf al-Sakhar|Iraq|32.86|44.12
Duhok;Dohuk|Iraq|36.87|42.99
Sinjar|Iraq|36.32|41.87
Al-Qaim|Iraq|34.37|41.09
Kurdistan Region;Iraqi Kurdistan|Iraq|36.40|44.30|r
Tehran;Iranian capital;Iran's capital;Iran’s capital|Iran|35.69|51.39
Isfahan;Esfahan|Iran|32.65|51.67
Natanz|Iran|33.72|51.73
Fordow;Fordo|Iran|34.88|50.99
Bandar Abbas|Iran|27.18|56.27
Bushehr|Iran|28.92|50.84
Shiraz|Iran|29.59|52.58
Tabriz|Iran|38.08|46.29
Kermanshah|Iran|34.31|47.07
Mashhad|Iran|36.30|59.61
Qom|Iran|34.64|50.88
Ahvaz;Ahwaz|Iran|31.32|48.67
Arak|Iran|34.09|49.69
Karaj|Iran|35.84|50.94
Chabahar|Iran|25.29|60.64
Kharg Island;Kharg|Iran|29.26|50.32
Hamadan|Iran|34.80|48.51
Parchin|Iran|35.52|51.77
Zahedan|Iran|29.50|60.86
Urmia|Iran|37.55|45.08
Semnan|Iran|35.58|53.39
Dezful|Iran|32.38|48.40
Abadan|Iran|30.34|48.30
Khuzestan|Iran|31.32|48.68|r
Strait of Hormuz;Hormuz|Iran|26.57|56.25|r
Sanaa;Sana'a;Sana’a;Yemeni capital;Yemen's capital;Yemen’s capital|Yemen|15.37|44.19
Aden|Yemen|12.79|45.02
Hodeidah;Hudaydah;Al Hudaydah;Hodeida|Yemen|14.80|42.95
Marib;Ma'rib|Yemen|15.47|45.32
Taiz;Ta'iz|Yemen|13.58|44.02
Saada;Sa'ada|Yemen|16.94|43.76
Mukalla|Yemen|14.54|49.12
Ras Isa|Yemen|15.20|42.62
Red Sea|Red Sea|19.50|38.80|r
Black Sea|Black Sea|43.30|34.00|r
Sea of Azov;Azov Sea|Sea of Azov|46.00|36.50|r
Gulf of Aden|Gulf of Aden|12.50|47.50|r
Bab el-Mandeb;Bab al-Mandab|Red Sea|12.58|43.33|r
Persian Gulf;Arabian Gulf|Persian Gulf|27.00|51.50|r
Kuwait City|Kuwait|29.38|47.98
Riyadh;Saudi capital|Saudi Arabia|24.71|46.68
Jeddah|Saudi Arabia|21.49|39.19
Dammam|Saudi Arabia|26.43|50.10
Abqaiq|Saudi Arabia|25.94|49.68
Ras Tanura|Saudi Arabia|26.64|50.16
Dhahran|Saudi Arabia|26.29|50.11
Abu Dhabi|UAE|24.45|54.38
Dubai|UAE|25.20|55.27
Fujairah|UAE|25.13|56.33
Doha|Qatar|25.29|51.53
Al Udeid|Qatar|25.12|51.32
Manama|Bahrain|26.23|50.59
Muscat|Oman|23.59|58.41
Amman|Jordan|31.95|35.93
Aqaba|Jordan|29.53|35.01
Cairo|Egypt|30.04|31.24
El Arish;Arish|Egypt|31.13|33.80
Port Said|Egypt|31.27|32.30
Sinai|Egypt|29.50|33.80|r
Ankara|Turkey|39.93|32.86
Istanbul|Turkey|41.01|28.98
Incirlik|Turkey|37.00|35.43
Diyarbakir|Turkey|37.91|40.24
Khartoum;Sudanese capital;Sudan's capital;Sudan’s capital|Sudan|15.50|32.56
Omdurman|Sudan|15.64|32.48
El Fasher;Al-Fashir;El-Fasher|Sudan|13.63|25.35
Port Sudan|Sudan|19.62|37.22
Nyala|Sudan|12.05|24.88
El Obeid|Sudan|13.18|30.22
Wad Madani|Sudan|14.40|33.52
Kadugli|Sudan|11.01|29.72
Babanusa|Sudan|11.33|27.81
El Geneina;Geneina|Sudan|13.45|22.45
Darfur|Sudan|13.50|24.50|r
Kordofan|Sudan|12.50|29.50|r
Juba|South Sudan|4.85|31.58
Addis Ababa|Ethiopia|9.03|38.74
Mekelle|Ethiopia|13.50|39.47
Gondar|Ethiopia|12.60|37.47
Tigray|Ethiopia|14.00|38.80|r
Amhara|Ethiopia|11.50|38.00|r
Mogadishu|Somalia|2.05|45.32
Kismayo|Somalia|-0.36|42.55
Bosaso|Somalia|11.28|49.18
Puntland|Somalia|8.40|49.00|r
Goma|DR Congo|-1.66|29.22
Bukavu|DR Congo|-2.51|28.86
Bunia|DR Congo|1.56|30.25
Kinshasa|DR Congo|-4.32|15.31
North Kivu|DR Congo|-0.70|28.80|r
South Kivu|DR Congo|-3.00|28.30|r
Ituri|DR Congo|1.70|29.80|r
Tripoli|Libya|32.89|13.19
Benghazi|Libya|32.12|20.09
Misrata|Libya|32.38|15.09
Sirte|Libya|31.21|16.59
Bamako|Mali|12.64|-8.00
Timbuktu|Mali|16.77|-3.01
Kidal|Mali|18.44|1.41
Ouagadougou|Burkina Faso|12.37|-1.52
Djibo|Burkina Faso|14.10|-1.63
Niamey|Niger|13.51|2.13
Abuja|Nigeria|9.08|7.40
Lagos|Nigeria|6.52|3.38
Maiduguri|Nigeria|11.85|13.16
Kano|Nigeria|12.00|8.52
Borno|Nigeria|11.80|13.10|r
Zamfara|Nigeria|12.10|6.20|r
N'Djamena;Ndjamena|Chad|12.13|15.06
Cabo Delgado|Mozambique|-12.30|39.80|r
Kabul|Afghanistan|34.53|69.17
Kandahar|Afghanistan|31.61|65.71
Jalalabad|Afghanistan|34.43|70.45
Herat|Afghanistan|34.35|62.20
Islamabad|Pakistan|33.68|73.05
Rawalpindi|Pakistan|33.60|73.04
Karachi|Pakistan|24.86|67.01
Lahore|Pakistan|31.55|74.34
Peshawar|Pakistan|34.01|71.58
Quetta|Pakistan|30.18|66.97
Bannu|Pakistan|32.99|70.60
Muzaffarabad|Pakistan|34.37|73.47
Balochistan;Baluchistan|Pakistan|28.50|65.50|r
Khyber Pakhtunkhwa|Pakistan|34.50|72.00|r
Waziristan|Pakistan|32.50|69.80|r
New Delhi;Delhi|India|28.61|77.21
Mumbai|India|19.08|72.88
Srinagar|India|34.08|74.80
Jammu|India|32.73|74.86
Pahalgam|India|34.02|75.31
Amritsar|India|31.63|74.87
Imphal|India|24.82|93.94
Kashmir|India|34.20|74.80|r
Manipur|India|24.70|93.90|r
Yangon;Rangoon|Myanmar|16.84|96.17
Mandalay|Myanmar|21.96|96.09
Naypyidaw;Nay Pyi Taw|Myanmar|19.76|96.08
Lashio|Myanmar|22.94|97.75
Myawaddy|Myanmar|16.69|98.51
Sagaing|Myanmar|21.88|95.98
Rakhine|Myanmar|20.10|93.80|r
Shan State|Myanmar|21.50|98.00|r
Taipei|Taiwan|25.03|121.57
Kaohsiung|Taiwan|22.63|120.30
Taiwan Strait|Taiwan|24.50|119.50|r
Beijing|China|39.90|116.40
Shanghai|China|31.23|121.47
Hong Kong|China|22.32|114.17
South China Sea|South China Sea|12.00|114.00|r
Seoul|South Korea|37.57|126.98
Pyongyang|North Korea|39.04|125.76
Tokyo|Japan|35.68|139.69
Okinawa|Japan|26.33|127.80|r
Manila|Philippines|14.60|120.98
Marawi|Philippines|8.00|124.29
Mindanao|Philippines|7.50|125.00|r
Bangkok|Thailand|13.76|100.50
Phnom Penh|Cambodia|11.56|104.92
Jakarta|Indonesia|-6.21|106.85
Washington, D.C.;Washington DC|USA|38.90|-77.04
New York|USA|40.71|-74.01
Caracas|Venezuela|10.49|-66.88
Cardon;Cardón;Punto Fijo|Venezuela|11.63|-70.22
Amuay|Venezuela|11.75|-70.22
Paraguana;Paraguaná|Venezuela|11.70|-70.05|r
El Palito|Venezuela|10.48|-68.12
Puerto La Cruz|Venezuela|10.21|-64.63
Bogota;Bogotá|Colombia|4.71|-74.07
Mexico City|Mexico|19.43|-99.13
Culiacan;Culiacán|Mexico|24.81|-107.39
Sinaloa|Mexico|25.00|-107.50|r
Port-au-Prince|Haiti|18.59|-72.31
London|UK|51.51|-0.13
Paris|France|48.86|2.35
Berlin|Germany|52.52|13.40
Brussels|Belgium|50.85|4.35
Alabama|USA|32.8|-86.8|r
Alaska|USA|64.0|-152.0|r
Arizona|USA|34.3|-111.7|r
Arkansas|USA|34.9|-92.4|r
California|USA|37.2|-119.5|r
Colorado|USA|39.0|-105.5|r
Connecticut|USA|41.6|-72.7|r
Delaware|USA|39.0|-75.5|r
Florida|USA|28.6|-82.4|r
Hawaii|USA|20.8|-156.3|r
Idaho|USA|44.4|-114.6|r
Illinois|USA|40.0|-89.2|r
Indiana|USA|39.9|-86.3|r
Iowa|USA|42.1|-93.5|r
Kansas|USA|38.5|-98.4|r
Kentucky|USA|37.5|-85.3|r
Louisiana|USA|31.1|-92.0|r
Maine|USA|45.4|-69.2|r
Maryland|USA|39.0|-76.8|r
Massachusetts|USA|42.3|-71.8|r
Michigan|USA|44.3|-85.4|r
Minnesota|USA|46.3|-94.3|r
Mississippi|USA|32.7|-89.7|r
Missouri|USA|38.4|-92.5|r
Montana|USA|47.0|-109.6|r
Nebraska|USA|41.5|-99.8|r
Nevada|USA|39.3|-116.6|r
New Hampshire|USA|43.7|-71.6|r
New Jersey|USA|40.2|-74.7|r
New Mexico|USA|34.4|-106.1|r
North Carolina|USA|35.6|-79.4|r
North Dakota|USA|47.5|-100.5|r
Ohio|USA|40.3|-82.8|r
Oklahoma|USA|35.6|-97.5|r
Oregon|USA|43.9|-120.6|r
Pennsylvania|USA|40.9|-77.8|r
Rhode Island|USA|41.7|-71.5|r
South Carolina|USA|33.9|-80.9|r
South Dakota|USA|44.4|-100.2|r
Tennessee|USA|35.9|-86.4|r
Texas|USA|31.5|-99.3|r
Utah|USA|39.3|-111.7|r
Vermont|USA|44.1|-72.7|r
Virginia|USA|37.5|-78.8|r
West Virginia|USA|38.6|-80.6|r
Wisconsin|USA|44.6|-89.9|r
Wyoming|USA|43.0|-107.5|r
British Columbia|Canada|54.0|-125.0|r
Alberta|Canada|55.0|-115.0|r
Saskatchewan|Canada|54.0|-106.0|r
Manitoba|Canada|55.0|-97.0|r
Ontario|Canada|50.0|-86.0|r
Quebec;Québec|Canada|52.0|-72.0|r
Nova Scotia|Canada|45.0|-63.0|r
New Brunswick|Canada|46.5|-66.2|r
Newfoundland|Canada|49.0|-56.0|r
Yukon|Canada|64.0|-135.0|r
Northwest Territories|Canada|64.8|-119.0|r
New South Wales|Australia|-32.5|147.0|r
Queensland|Australia|-22.5|144.5|r
Western Australia|Australia|-25.5|122.0|r
South Australia|Australia|-30.0|135.8|r
Tasmania|Australia|-42.0|146.6|r
Northern Territory|Australia|-19.5|133.4|r
Siberia|Russia|60.0|100.0|r
Yakutia;Sakha|Russia|63.0|129.0|r
Amazon;Amazon rainforest;Amazonia|Brazil|-5.0|-62.0|r
Pantanal|Brazil|-17.0|-57.0|r
Patagonia|Argentina|-45.0|-70.0|r
Evia;Euboea|Greece|38.6|23.6|r
Rhodes|Greece|36.2|28.0|r
Attica|Greece|38.0|23.8|r
Catalonia|Spain|41.8|1.5|r
Andalusia|Spain|37.5|-4.5|r
Canary Islands;Tenerife|Spain|28.3|-16.2|r
Algarve|Portugal|37.2|-8.2|r
Madeira|Portugal|32.75|-16.95|r
Provence|France|43.9|6.0|r
Sardinia|Italy|40.1|9.0|r
Sicily|Italy|37.5|14.1|r
Borneo;Kalimantan|Indonesia|0.5|114.0|r
Sumatra|Indonesia|0.0|101.5|r
`;

// Map country names (Natural Earth, as used by world-atlas) to the names headlines use.
// The first alias is also the display name. Countries not listed match on their map name.
const COUNTRY_ALIASES = {
  "United States of America": ["United States", "U.S.", "US", "USA", "America"],
  "United Kingdom": ["UK", "U.K.", "Britain"],
  "Dem. Rep. Congo": ["DR Congo", "DRC", "Democratic Republic of Congo", "Democratic Republic of the Congo"],
  Congo: ["Republic of Congo", "Congo-Brazzaville"],
  "Central African Rep.": ["Central African Republic", "CAR"],
  "S. Sudan": ["South Sudan"],
  "Côte d'Ivoire": ["Ivory Coast", "Côte d'Ivoire", "Cote d'Ivoire"],
  "Bosnia and Herz.": ["Bosnia", "Bosnia and Herzegovina"],
  "Dominican Rep.": ["Dominican Republic"],
  "Eq. Guinea": ["Equatorial Guinea"],
  "W. Sahara": ["Western Sahara"],
  "N. Cyprus": ["Northern Cyprus"],
  "Solomon Is.": ["Solomon Islands"],
  Macedonia: ["North Macedonia"],
  "North Macedonia": ["North Macedonia"],
  Myanmar: ["Myanmar", "Burma"],
  Palestine: ["Palestine", "Palestinian territories"],
  Czechia: ["Czechia", "Czech Republic"],
  eSwatini: ["Eswatini", "Swaziland"],
  "United Arab Emirates": ["UAE", "United Arab Emirates", "Emirates"],
  "Saudi Arabia": ["Saudi Arabia", "Saudi"],
  Turkey: ["Turkey", "Türkiye"],
};

// Country names that are also common words or first names. They still show as a report's
// country, but a headline can't be pinned to the whole country by these words alone.
const COUNTRY_SKIP = new Set(["Jordan", "Chad", "Georgia", "Turkey", "Guinea", "America", "CAR", "US", "Saudi"]);

// Countries whose largest landmass centroid is a poor stand-in for "somewhere in the country"
// in news reports (for Russia that would be central Siberia).
const COUNTRY_CENTER = {
  Russia: [55.5, 40.0],
  "United States of America": [39.0, -98.0],
  Canada: [52.0, -100.0],
  Norway: [61.0, 9.0],
  Chile: [-33.5, -70.8],
};

// Featured locations, shown in the left panel and as blue pins.
const FEATURED_PLACES = [
  { id: "kuwait-city", name: "Kuwait City", lat: 29.3759, lng: 47.9774, description: "Capital of Kuwait, on the northwest shore of the Persian Gulf." },
  { id: "tehran", name: "Tehran", lat: 35.6892, lng: 51.389, description: "Capital of Iran, on the southern slopes of the Alborz mountains." },
  { id: "tel-aviv", name: "Tel Aviv", lat: 32.0853, lng: 34.7818, description: "Mediterranean coastal city and Israel's main economic center." },
  { id: "kyiv", name: "Kyiv", lat: 50.4501, lng: 30.5234, description: "Capital of Ukraine, straddling the Dnieper River." },
  { id: "baghdad", name: "Baghdad", lat: 33.3152, lng: 44.3661, description: "Capital of Iraq, on the Tigris River." },
  { id: "damascus", name: "Damascus", lat: 33.5138, lng: 36.2765, description: "Capital of Syria and one of the oldest continuously inhabited cities." },
  { id: "sanaa", name: "Sana'a", lat: 15.3694, lng: 44.191, description: "Capital of Yemen, high in the western Sarawat mountains." },
  { id: "beirut", name: "Beirut", lat: 33.8938, lng: 35.5018, description: "Capital of Lebanon, on a peninsula in the eastern Mediterranean." },
  { id: "taipei", name: "Taipei", lat: 25.033, lng: 121.5654, description: "Capital of Taiwan, in a basin ringed by volcanic hills." },
  { id: "kharkiv", name: "Kharkiv", lat: 49.9935, lng: 36.2304, description: "Major city in northeastern Ukraine, near the Russian border." },
];
