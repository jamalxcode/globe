param([string]$Points, [string]$Out = "$PSScriptRoot\..\provinces.js")
# Builds provinces.js: first-level regions (oblasts, provinces, states, governorates) for the countries that
# dominate conflict and disaster news, from Natural Earth's admin-1 label points (public domain).
# Usage: download ne_10m_admin_1_label_points_details.geojson from
# https://github.com/nvkelso/natural-earth-vector/tree/master/geojson, then:
#   powershell -File scripts\build-provinces.ps1 -Points <that file>
$ErrorActionPreference = "Stop"
$utf8 = [Text.UTF8Encoding]::new($false)

# ISO code -> the country name the rest of the site uses.
$countries = [ordered]@{
  UA = "Ukraine"; RU = "Russia"; IR = "Iran"; IQ = "Iraq"; SY = "Syria"; YE = "Yemen"; SD = "Sudan"
  IL = "Israel"; PS = "Palestine"; LB = "Lebanon"; NG = "Nigeria"; ET = "Ethiopia"; SO = "Somalia"
  CD = "DR Congo"; PK = "Pakistan"; IN = "India"; MM = "Myanmar"; TR = "Turkey"; MX = "Mexico"; BR = "Brazil"; CN = "China"
}

# Names that are common words, people's names, or other places: these match only with a suffix
# ("Rivers State", "Fars province"), never alone. Written with a leading "~" in provinces.js.
$suffixOnly = @(
  "Central", "Western", "Eastern", "Northern", "Southern", "North", "South", "East", "West", "Capital", "Federal",
  "Delta", "Rivers", "Plateau", "Guerrero", "Hidalgo", "Tabasco", "Morelos", "Durango", "Van", "Batman", "Bari", "Bay",
  "Somali", "Afar", "Karen", "Chin", "Mon", "Shan", "Kurdistan", "Fars", "Acre", "Santa Catarina", "Mexico", "México",
  "Distrito Federal", "Federal District", "Red Sea", "Ordu", "Kayah", "Kogi", "Niger", "Lagos", "Amazonas", "Para", "Pará",
  "Sennar", "Gambela", "Harari", "Jerusalem", "Mount Lebanon", "Akkar", "Ondo", "Imo", "Edo", "Ogun", "Oyo", "Ekiti",
  "Jilin", "Henan", "Hunan", "Hubei", "Hebei", "Georgia", "Victoria", "Mus", "Muş", "Bolu", "Rize", "Kars"
)
$suffixSet = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
foreach ($n in $suffixOnly) { [void]$suffixSet.Add($n) }

function Strip-Type([string]$s) {
  if (-not $s) { return $null }
  $s = $s -replace '^(Republic of|Emirate of|State of|Province of|Region of)\s+', ''
  $s = $s -replace '\s+(Oblast|Province|Governorate|State|Region|District|Krai|Kray|Republic|Autonomous Okrug|Autonomous Oblast|Autonomous Region|Uygur Autonomous Region|Zhuang Autonomous Region|Hui Autonomous Region|Municipality|Division|Prefecture|Territory|Union Territory|Federal District|Autonomous Republic|City)$', ''
  return $s.Trim()
}

function Fold([string]$s) {
  $n = $s.Normalize([Text.NormalizationForm]::FormD)
  $b = New-Object Text.StringBuilder
  foreach ($c in $n.ToCharArray()) { if ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($c) -ne 'NonSpacingMark') { [void]$b.Append($c) } }
  # Curly apostrophe and backtick become a plain apostrophe (written as char codes: PowerShell 5 reads a curly
  # apostrophe as a quote mark).
  return $b.ToString().Normalize([Text.NormalizationForm]::FormC) -replace ("[" + [char]0x2019 + [char]96 + "]"), "'"
}

$geo = [IO.File]::ReadAllText($Points, $utf8) | ConvertFrom-Json
$rows = @()
foreach ($f in $geo.features) {
  $p = $f.properties
  if (-not $countries.Contains([string]$p.iso_a2)) { continue }
  # City-level units (Moscow City, Kyiv City, Beijing Municipality) duplicate the city list.
  if ([string]$p.type_en -match 'City|Municipality') { continue }
  # Display name with its kind, as news writes it: "Kursk Oblast", "Khuzestan Province", "Borno State".
  $base = Strip-Type $(if ($p.name_en) { [string]$p.name_en } else { [string]$p.name })
  $kind = [string]$p.type_en
  $display = if ($kind -match '^(Oblast|Province|State|Governorate|Region|Krai|District|Republic)$') { if ($kind -eq 'Republic') { "$base Republic" } else { "$base $kind" } } else { $base }
  $names = New-Object System.Collections.Generic.List[string]
  $names.Add($display)
  foreach ($n in @($p.name, $p.name_en, (Strip-Type $p.name_en), (Strip-Type $p.name)) + @(([string]$p.name_alt) -split '\|')) {
    if (-not $n) { continue }
    foreach ($v in @($n.Trim(), (Fold $n.Trim()))) {
      if ($v.Length -ge 4 -and $v -match '^[\p{L}][\p{L}\p{M}\s\-''.]+$' -and -not $names.Contains($v)) { $names.Add($v) }
    }
  }
  if (-not $names.Count) { continue }
  $rows += [pscustomobject]@{ display = $display; country = $countries[[string]$p.iso_a2]; lat = [double]$p.latitude; lng = [double]$p.longitude; names = $names }
}

# A name used by provinces in two countries (Punjab in India and Pakistan) is ambiguous: leave it out.
$count = @{}
foreach ($r in $rows) { foreach ($n in ($r.names | Select-Object -Unique)) { $k = $n.ToLowerInvariant(); $count[$k] = 1 + [int]$count[$k] } }
$inv = [Globalization.CultureInfo]::InvariantCulture
$lines = foreach ($r in ($rows | Sort-Object country, display)) {
  $keep = @($r.names | Where-Object { $count[$_.ToLowerInvariant()] -eq 1 } | ForEach-Object { if ($suffixSet.Contains($_)) { "~$_" } else { $_ } })
  if (-not $keep.Count) { continue }
  # Display name first (it may itself be suffix-only; the matcher strips the "~").
  "{0}|{1}|{2}|{3}" -f ($keep -join ";"), $r.country, [Math]::Round($r.lat, 3).ToString($inv), [Math]::Round($r.lng, 3).ToString($inv)
}
$header = @"
// Generated by scripts/build-provinces.ps1 from Natural Earth admin-1 label points (public domain).
// First-level regions for 21 countries common in conflict and disaster news. Same format as PLACE_LINES,
// all regions; a leading "~" marks a name that only counts with a suffix ("Rivers State", "Fars province").
// cities.js and places.js take priority when a name appears there too.
const PROVINCE_LINES = ``
"@
[IO.File]::WriteAllText($Out, $header + "`n" + ($lines -join "`n") + "`n``;`n", $utf8)
"provinces: $($lines.Count)"
