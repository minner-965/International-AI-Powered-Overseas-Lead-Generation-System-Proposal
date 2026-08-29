[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^\\\\')]
    [string]$SharePath,
    [switch]$IncludeFiles
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$supportedExtensions = @(
    '.xlsx', '.xls', '.xlsm', '.csv', '.docx', '.doc', '.pdf', '.txt',
    '.pptx', '.zip', '.jpg', '.jpeg', '.png'
)

function Get-BusinessClassification {
    param(
        [Parameter(Mandatory)] [string]$RelativePath,
        [Parameter(Mandatory)] [string]$Extension
    )

    $text = $RelativePath.ToLowerInvariant()

    if ($text -match '(^|\\)7\.hr-|(^|\\)8\.财务|身份证|passport|bank\s*account|salary|payroll|人事|员工|工资|薪资|password|credential|账户银行流水|account fund transfer|账户流水|资金流动明细|内部支出明细账') { return 'SENSITIVE_REVIEW' }
    if ($text -match 'crm|客户关系') { return 'CRM_EXPORT' }
    if ($text -match '\berp\b') { return 'ERP_EXPORT' }
    if ($text -match '开发信|邮件模板|whatsapp|销售话术|话术|faq|报价模板|异议|成功案例|客户沟通|sales\s*message|email\s*template|quotation\s*template|objection|跟单流程|验货标准|操作指南|注意事项|流程及') { return 'SALES_KNOWLEDGE' }
    if ($text -match '报价|quotation|quote|pricelist|price\s*list|价目表|价格表') { return 'QUOTATIONS' }
    if ($Extension -in @('.jpg', '.jpeg', '.png')) { return 'PRODUCT_ASSETS' }
    if ($text -match '发票跟进登记|customs declaration summary|报关单汇总') { return 'HISTORICAL_ORDERS' }
    if ($text -match '潜客|线索|询盘|开发客户|未成交|丢单|\blead|prospect|pipeline|follow[- ]?up|inquir|\blost\b') { return 'HISTORICAL_LEADS' }
    if ($text -match '订单|销售订单|出货|发货|销售明细|发票|shipment|orders?|\bsales\b|invoice|合同|装箱单|packing|container\s*list|pedido|purchase\s*order') { return 'HISTORICAL_ORDERS' }
    if ($text -match '客户名单|成交客户|老客户|客户档案|historical.?customer|\bcustomers?\b|\bclients?\b') { return 'HISTORICAL_CUSTOMERS' }
    if ($text -match '渠道|channel') { return 'CHANNEL_DATA' }
    if ($text -match '商品|产品|sku|货号|款号|女装|服装|日用品|义乌|moq|起订量|规格|材质|尺寸|包装|认证|交期|产能|product|catalog|样品|sample') { return 'PRODUCT_MASTER' }
    if ($text -match '供应商|服务商|工厂|采购|供货|supply|factory|vendor') { return 'SUPPLY_CHAIN' }
    if ($text -match '桶装水|行政表单|\bpdf下载\b') { return 'NOT_RELEVANT' }
    return 'UNKNOWN'
}

if (-not (Test-Path -LiteralPath $SharePath -PathType Container)) {
    throw "Shared folder is not accessible: $SharePath"
}

$share = Get-Item -LiteralPath $SharePath
$files = Get-ChildItem -LiteralPath $share.FullName -File -Recurse -Force -ErrorAction SilentlyContinue |
    Where-Object {
        $supportedExtensions -contains $_.Extension.ToLowerInvariant() -and
        $_.Name -notlike '~$*' -and
        $_.Name -notin @('desktop.ini', 'Thumbs.db') -and
        $_.Name -notmatch '\.(tmp|temp|lock)$'
    }

$records = $files | ForEach-Object {
    $relativePath = $_.FullName.Substring($share.FullName.Length).TrimStart('\')
    $extension = $_.Extension.ToLowerInvariant()
    [pscustomobject]@{
        FullPath       = $_.FullName
        RelativePath   = $relativePath
        FileName       = $_.Name
        Extension      = $extension
        SizeBytes      = [int64]$_.Length
        LastModifiedUtc = $_.LastWriteTimeUtc
        ParentFolder   = Split-Path $relativePath -Parent
        Classification = Get-BusinessClassification -RelativePath $relativePath -Extension $extension
    }
}

$summary = [pscustomobject]@{
    RecordType    = 'SUMMARY'
    SharedFolder  = $share.FullName
    Access        = 'PASS'
    ReadOnlyScan  = $true
    FileCount     = @($records).Count
    TotalBytes    = [int64](($records | Measure-Object SizeBytes -Sum).Sum)
    Extensions    = @($records | Group-Object Extension | Sort-Object Count -Descending | ForEach-Object {
        [pscustomobject]@{ Name = $_.Name; Files = $_.Count; Bytes = [int64](($_.Group | Measure-Object SizeBytes -Sum).Sum) }
    })
    Classifications = @($records | Group-Object Classification | Sort-Object Count -Descending | ForEach-Object {
        [pscustomobject]@{ Name = $_.Name; Files = $_.Count; Bytes = [int64](($_.Group | Measure-Object SizeBytes -Sum).Sum) }
    })
}

$summary
if ($IncludeFiles) {
    $records | Select-Object FullPath, RelativePath, FileName, Extension, SizeBytes, LastModifiedUtc, ParentFolder, Classification
}
