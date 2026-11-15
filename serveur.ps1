# Petit serveur web local pour l'appli (aucune installation nécessaire).
# Lancement : double-clic sur « Lancer l'appli.bat », ou : powershell -ExecutionPolicy Bypass -File serveur.ps1
# Puis ouvrir http://localhost:8090 dans Chrome ou Edge. Ctrl+C pour arrêter.
# Il sert aussi la sortie DMX du testeur (Art-Net / sACN) : le navigateur ne peut pas envoyer
# de paquets réseau lui-même, c'est ce serveur qui les envoie.
param([int]$Port = 8090, [switch]$Open)   # 8080 est pris par grandMA3 onPC (télécommande web) ; -Open ouvre le navigateur

$root = $PSScriptRoot
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.svg' = 'image/svg+xml'; '.json' = 'application/json'
  '.webmanifest' = 'application/manifest+json'; '.png' = 'image/png'; '.md' = 'text/plain; charset=utf-8'
}

# ---------- Sortie DMX ----------
$script:udp = @{}          # une prise réseau par carte réseau choisie
$script:seq = @{}          # numéro de séquence par univers
$script:cid = [Guid]::NewGuid().ToByteArray()   # identifiant sACN de cette source
$script:srcName = [Text.Encoding]::UTF8.GetBytes('MA3 Fixture Builder')

function Get-Udp([string]$iface) {
  $k = if ($iface) { $iface } else { '*' }
  if (-not $script:udp.ContainsKey($k)) {
    $local = if ($iface) { [Net.IPAddress]::Parse($iface) } else { [Net.IPAddress]::Any }
    $c = New-Object Net.Sockets.UdpClient (New-Object Net.IPEndPoint $local, 0)
    $c.EnableBroadcast = $true
    $c.Client.SetSocketOption([Net.Sockets.SocketOptionLevel]::IP, [Net.Sockets.SocketOptionName]::MulticastTimeToLive, 8)
    if ($iface) {
      $c.Client.SetSocketOption([Net.Sockets.SocketOptionLevel]::IP, [Net.Sockets.SocketOptionName]::MulticastInterface, $local.GetAddressBytes())
    }
    $script:udp[$k] = $c
  }
  return $script:udp[$k]
}

function Next-Seq([string]$key) {
  $n = if ($script:seq.ContainsKey($key)) { ($script:seq[$key] + 1) % 256 } else { 1 }
  if ($n -eq 0) { $n = 1 }
  $script:seq[$key] = $n
  return [byte]$n
}

# Paquet Art-Net ArtDmx (port 6454). $universe = adresse de port Art-Net 0-32767 (Net, Sub-Net, Univers)
function New-ArtDmx([int]$universe, [byte[]]$data) {
  $p = New-Object byte[] 530
  [Array]::Copy([Text.Encoding]::ASCII.GetBytes('Art-Net'), $p, 7)
  $p[8] = 0x00; $p[9] = 0x50          # OpCode ArtDmx (0x5000, octet de poids faible d'abord)
  $p[11] = 14                          # version du protocole
  $p[12] = Next-Seq "a$universe"
  $p[14] = $universe -band 0xFF        # Sub-Net + Univers
  $p[15] = ($universe -shr 8) -band 0x7F   # Net
  $p[16] = 2; $p[17] = 0               # 512 octets
  [Array]::Copy($data, 0, $p, 18, 512)
  return ,$p
}

# Paquet sACN / E1.31 (port 5568, multidiffusion 239.255.x.y). $universe = 1-63999
function New-Sacn([int]$universe, [byte[]]$data) {
  $p = New-Object byte[] 638
  $p[1] = 0x10                                                     # taille du préambule
  [Array]::Copy([Text.Encoding]::ASCII.GetBytes("ASC-E1.17"), 0, $p, 4, 9)
  $fl = { param($i, $len) $v = 0x7000 -bor $len; $p[$i] = ($v -shr 8) -band 0xFF; $p[$i + 1] = $v -band 0xFF }
  & $fl 16 (638 - 16)
  $p[21] = 0x04                                                    # vecteur racine : données E1.31
  [Array]::Copy($script:cid, 0, $p, 22, 16)
  & $fl 38 (638 - 38)
  $p[43] = 0x02                                                    # vecteur trame : données DMX
  [Array]::Copy($script:srcName, 0, $p, 44, [Math]::Min(63, $script:srcName.Length))
  $p[108] = 100                                                    # priorité
  $p[111] = Next-Seq "s$universe"
  $p[113] = ($universe -shr 8) -band 0xFF; $p[114] = $universe -band 0xFF
  & $fl 115 (638 - 115)
  $p[117] = 0x02; $p[118] = 0xA1                                   # DMP : valeurs
  $p[122] = 0x01                                                   # incrément d'adresse
  $p[123] = 0x02; $p[124] = 0x01                                   # 513 valeurs (code de départ + 512)
  [Array]::Copy($data, 0, $p, 126, 512)
  return ,$p
}

function Send-Dmx($o) {
  $data = [Convert]::FromBase64String([string]$o.data)
  if ($data.Length -ne 512) { throw 'trame DMX invalide' }
  $iface = [string]$o.iface
  $u = [int]$o.universe
  $c = Get-Udp $iface
  if ($o.proto -eq 'sacn') {
    if ($u -lt 1 -or $u -gt 63999) { throw 'univers sACN invalide' }
    $pkt = New-Sacn $u $data
    $dest = "239.255.$(($u -shr 8) -band 0xFF).$($u -band 0xFF)"
    [void]$c.Send($pkt, $pkt.Length, $dest, 5568)
  } else {
    if ($u -lt 0 -or $u -gt 32767) { throw 'univers Art-Net invalide' }
    $dest = [Net.IPAddress]::Parse([string]$o.dest).ToString()
    $pkt = New-ArtDmx $u $data
    [void]$c.Send($pkt, $pkt.Length, $dest, 6454)
  }
}

# Cartes réseau actives (IPv4), avec leur adresse de diffusion
function Get-Interfaces {
  $list = @()
  foreach ($ni in [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
    if ($ni.OperationalStatus -ne 'Up' -or $ni.NetworkInterfaceType -eq 'Loopback') { continue }
    foreach ($ua in $ni.GetIPProperties().UnicastAddresses) {
      if ($ua.Address.AddressFamily -ne 'InterNetwork') { continue }
      $ip = $ua.Address.GetAddressBytes()
      $mask = if ($ua.IPv4Mask) { $ua.IPv4Mask.GetAddressBytes() } else { [byte[]](255, 255, 255, 0) }
      $bc = for ($i = 0; $i -lt 4; $i++) { $ip[$i] -bor (255 -bxor $mask[$i]) }
      $list += [ordered]@{ name = $ni.Name; ip = $ua.Address.ToString(); broadcast = ($bc -join '.') }
    }
  }
  return ,$list
}

function Write-Json($res, $obj) {
  $bytes = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $obj -Compress -Depth 4))
  $res.ContentType = 'application/json; charset=utf-8'
  $res.Headers.Add('Cache-Control', 'no-store')
  $res.OutputStream.Write($bytes, 0, $bytes.Length)
}

# ---------- Serveur web ----------
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Fixture Builder disponible sur http://localhost:$Port  (Ctrl+C pour arrêter)"
if ($Open) { Start-Process "http://localhost:$Port" }

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    try {
      $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath.TrimStart('/'))
      if ($path -like 'api/*') {
        # Seule l'appli elle-même peut piloter la sortie DMX (pas une autre page ouverte dans le navigateur)
        $origin = $req.Headers['Origin']
        if ($origin -and $origin -ne "http://localhost:$Port") { $res.StatusCode = 403 }
        elseif ($path -eq 'api/dmx/info' -and $req.HttpMethod -eq 'GET') {
          Write-Json $res @{ ok = $true; interfaces = (Get-Interfaces) }
        }
        elseif ($path -eq 'api/dmx' -and $req.HttpMethod -eq 'POST' -and $req.ContentType -like 'application/json*') {
          $reader = New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)
          $body = $reader.ReadToEnd()
          $reader.Close()
          try {
            Send-Dmx (ConvertFrom-Json $body)
            $res.StatusCode = 204
          } catch {
            $res.StatusCode = 400
            Write-Json $res @{ ok = $false; error = $_.Exception.Message }
          }
        }
        else { $res.StatusCode = 404 }
        continue
      }
      if ($path -eq '') { $path = 'index.html' }
      $file = [IO.Path]::GetFullPath((Join-Path $root $path))
      if ($file.StartsWith($root) -and (Test-Path $file -PathType Leaf)) {
        $ext = [IO.Path]::GetExtension($file).ToLower()
        $res.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
        $res.Headers.Add('Cache-Control', 'no-cache')
        $bytes = [IO.File]::ReadAllBytes($file)
        if ($req.HttpMethod -ne 'HEAD') {
          $res.OutputStream.Write($bytes, 0, $bytes.Length)
        }
      } else {
        $res.StatusCode = 404
      }
    } catch {
      Write-Host "Erreur : $($_.Exception.Message)"
    } finally {
      try { $res.Close() } catch {}
    }
  }
} finally {
  $listener.Stop()
  foreach ($c in $script:udp.Values) { try { $c.Close() } catch {} }
}
