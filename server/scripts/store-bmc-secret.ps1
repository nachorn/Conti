param([switch]$FromClipboard, [switch]$Help)
$ErrorActionPreference = 'Stop'
if ($Help) {
  Write-Output 'Store the actual BMC signing secret in a new private ignored .cache folder. Use -FromClipboard only after copying that secret in the provider dashboard; otherwise enter it privately at the prompt.'
  exit 0
}
try {
  $repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
  $privateRoot = Join-Path $repositoryRoot '.cache'
  $ignored = & git -C $repositoryRoot check-ignore --quiet -- '.cache/bmc-private-check/webhook.env'
  if ($LASTEXITCODE -ne 0) { throw 'Private path must be ignored by Git' }
  if ($FromClipboard) { $bmcValue = (Get-Clipboard -Raw).Trim() }
  else {
    $protectedValue = Read-Host 'BMC webhook signing secret' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($protectedValue)
    try { $bmcValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $protectedValue.Dispose() }
  }
  if ($bmcValue -notmatch '^[A-Za-z0-9_+=/.-]{16,256}$') { throw 'Unexpected signing secret format' }
  [IO.Directory]::CreateDirectory($privateRoot) | Out-Null
  $targetFolder = Join-Path $privateRoot ('bmc-private-' + [Guid]::NewGuid().ToString('N'))
  [IO.Directory]::CreateDirectory($targetFolder) | Out-Null
  $ownerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $directoryAcl = [Security.AccessControl.DirectorySecurity]::new()
  $directoryAcl.SetOwner($ownerSid)
  $directoryAcl.SetAccessRuleProtection($true, $false)
  $directoryAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($ownerSid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
  Set-Acl -LiteralPath $targetFolder -AclObject $directoryAcl
  $secretFile = Join-Path $targetFolder 'webhook.env'
  $stream = [IO.FileStream]::new($secretFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes('BMC_WEBHOOK_SECRET=' + $bmcValue + [Environment]::NewLine)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush($true)
    [Array]::Clear($bytes, 0, $bytes.Length)
  } finally { $stream.Dispose() }
  if ($FromClipboard) { Set-Clipboard -Value '' }
  [pscustomobject]@{ stored = $true; secretFile = $secretFile; access = 'current-user-only'; gitIgnored = $true } | ConvertTo-Json -Compress
} catch {
  Write-Error 'Secret storage failed. No secret value is included in this message; check the local private folder and retry.'
  exit 1
} finally { $bmcValue = $null }
