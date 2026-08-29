#!/usr/bin/env python3
"""Stage and normalize the two OKKI exports without writing to their source paths."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import shutil
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import openpyxl


BATCH_KEY = "phase5-v2.3.1-okki-history-001"
COUNTRY_CODES = {
    "俄罗斯": "RU", "英国": "GB", "阿联酋": "AE", "印尼": "ID",
    "南非": "ZA", "墨西哥": "MX", "巴西": "BR", "澳大利亚": "AU",
    "爱尔兰": "IE", "约旦": "JO",
}
SOCIAL_HEADERS = (
    "Facebook", "Linkedin", "Whatsapp", "Wechat", "Instagram", "Twitter",
    "Youtube", "Messenger", "Line", "Vk", "Telegram", "Crunchbase",
    "Angellist", "Pinterest", "Tiktok", "Kakaotalk", "Zalo", "Etsy",
    "Reddit", "Red", "Shopee", "Viber", "Skype", "Qq", "Wecom", "阿里TM",
)
GENERIC_MAILBOX = re.compile(r"^(?:info|sales|contact|office|admin|support|hello|enquir(?:y|ies)|service|marketing|mail)@", re.I)


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def digest_json(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=json_value)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def json_value(value: Any) -> Any:
    if isinstance(value, (dt.datetime, dt.date)):
        return value.isoformat()
    return value


def clean(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, str):
        value = value.replace("\u00a0", " ").strip()
        return value or None
    if isinstance(value, (dt.datetime, dt.date, int, float, bool)):
        return value
    return str(value).strip() or None


def timestamp(value: Any) -> str | None:
    value = clean(value)
    if isinstance(value, dt.datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=dt.timezone(dt.timedelta(hours=8)))
        return value.isoformat()
    if isinstance(value, dt.date):
        return dt.datetime.combine(value, dt.time(), tzinfo=dt.timezone(dt.timedelta(hours=8))).isoformat()
    if not value or str(value).startswith("1970-01-01"):
        return None
    return str(value)


def boolean_value(value: Any) -> bool | None:
    value = str(clean(value) or "").casefold()
    if value in {"是", "yes", "true", "1", "主联系人", "主要联系人"}:
        return True
    if value in {"否", "no", "false", "0"}:
        return False
    return None


def tags(value: Any) -> list[str]:
    raw = str(clean(value) or "")
    if not raw:
        return []
    return [item for item in (part.strip() for part in re.split(r"[,，;；|\n]+", raw)) if item]


def website_domain(value: Any) -> str | None:
    raw = str(clean(value) or "")
    if not raw:
        return None
    parsed = urlparse(raw if "://" in raw else f"https://{raw}")
    host = (parsed.hostname or "").casefold()
    return re.sub(r"^www\.", "", host) or None


def typed_identity(cell: Any) -> dict[str, str]:
    value = cell.value
    if isinstance(value, bool):
        raise ValueError("Boolean OKKI customer ID is not supported")
    if isinstance(value, int) or isinstance(value, float) and value.is_integer():
        raw = str(int(value))
        source_type = "int"
        token = raw
    else:
        raw = str(value or "").strip()
        source_type = "text"
        semantic = raw[1:] if raw.startswith("'") else raw
        token = f"'{semantic}" if semantic.isdigit() else semantic
    if not raw:
        raise ValueError("OKKI customer ID is blank")
    return {
        "raw": raw,
        "type": source_type,
        "key": f"OKKI:{source_type}:{token}",
    }


def snapshot(path: Path) -> dict[str, Any]:
    stat = path.stat()
    return {
        "path": str(path),
        "filename": path.name,
        "size": stat.st_size,
        "last_modified": dt.datetime.fromtimestamp(stat.st_mtime, dt.timezone.utc).isoformat(),
        "sha256": sha256(path),
    }


def stage_source(source: Path, destination: Path, sequence: int) -> dict[str, Any]:
    before = snapshot(source)
    destination.mkdir(parents=True, exist_ok=True)
    local = destination / f"source-{sequence:02d}{source.suffix.casefold()}"
    shutil.copy2(source, local)
    local_hash = sha256(local)
    after = snapshot(source)
    if before != after or before["sha256"] != local_hash:
        raise RuntimeError(f"Source changed during read-only staging: {source}")
    return {
        "source_unc_path": str(source),
        "source_filename": source.name,
        "source_last_modified": before["last_modified"],
        "source_size": before["size"],
        "source_sha256_before": before["sha256"],
        "local_staging_path": str(local),
        "local_sha256": local_hash,
        "source_sha256_after": after["sha256"],
        "copied_at": utc_now(),
        "hash_verified": True,
    }


def read_sheet(path: Path) -> tuple[str, list[str], list[tuple[Any, ...]], dict[str, list[int]]]:
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=False, keep_links=False)
    worksheet = workbook.active
    rows = list(worksheet.iter_rows())
    headers = [str(cell.value or "").strip() for cell in rows[0]]
    positions: dict[str, list[int]] = defaultdict(list)
    for index, header in enumerate(headers):
        positions[header].append(index)
    result = (worksheet.title, headers, rows[1:], positions)
    workbook.close()
    return result


def row_get(row: tuple[Any, ...], positions: dict[str, list[int]], name: str) -> Any:
    for index in positions.get(name, []):
        value = clean(row[index].value)
        if value is not None:
            return value
    return None


def raw_row(row: tuple[Any, ...], headers: list[str]) -> dict[str, Any]:
    output: dict[str, Any] = {}
    counts: dict[str, int] = defaultdict(int)
    for index, header in enumerate(headers):
        counts[header] += 1
        key = header if counts[header] == 1 else f"{header}__{counts[header]}"
        output[key] = json_value(clean(row[index].value))
    return output


def customer_stage(status: Any) -> tuple[str, str]:
    status = str(clean(status) or "")
    if status == "在跟进":
        return "OPEN", "IN_PROGRESS"
    if status == "待跟进":
        return "OPEN", "PENDING"
    return "UNKNOWN", "NO_STATUS"


def build_bundle(customer_file: Path, trail_file: Path, manifests: list[dict[str, Any]]) -> dict[str, Any]:
    customer_sheet, customer_headers, customer_rows, customer_positions = read_sheet(customer_file)
    trail_sheet, trail_headers, trail_rows, trail_positions = read_sheet(trail_file)
    customer_id_index = customer_positions["客户编号"][0]
    trail_id_index = trail_positions["客户编号"][0]

    customer_groups: dict[str, list[tuple[int, tuple[Any, ...], dict[str, str]]]] = defaultdict(list)
    for source_row, row in enumerate(customer_rows, start=2):
        identity = typed_identity(row[customer_id_index])
        customer_groups[identity["key"]].append((source_row, row, identity))

    activity_rows: list[dict[str, Any]] = []
    activity_customer_keys: set[str] = set()
    activity_distribution: Counter[str] = Counter()
    errors: list[dict[str, Any]] = []
    for source_row, row in enumerate(trail_rows, start=2):
        identity = typed_identity(row[trail_id_index])
        activity_customer_keys.add(identity["key"])
        raw_type = str(row_get(row, trail_positions, "动态类型") or "")
        raw_title = str(row_get(row, trail_positions, "标题") or "")
        raw_content = str(row_get(row, trail_positions, "内容") or "")
        if raw_type == "EDM" and raw_title == "发送了一次营销":
            normalized_type, topic, channel = "OUTBOUND_MARKETING_EMAIL_SENT", "MARKETING_OUTREACH", "EMAIL"
        elif raw_type == "跟进" and raw_title == "新建了快速记录跟进":
            normalized_type = "MANUAL_FOLLOW_UP"
            topic = "QUOTATION_FOLLOW_UP" if "报价" in raw_content else "GENERAL_FOLLOW_UP"
            channel = "WECHAT" if "微信" in raw_content else None
        else:
            errors.append({"source": "trail", "source_row": source_row, "reason": "UNSUPPORTED_ACTIVITY_MAPPING"})
            continue
        activity_at = timestamp(row_get(row, trail_positions, "跟进时间")) or timestamp(row_get(row, trail_positions, "创建时间"))
        if not activity_at:
            errors.append({"source": "trail", "source_row": source_row, "reason": "ACTIVITY_DATE_REQUIRED"})
            continue
        source_identity_key = digest_json([manifests[1]["local_sha256"], trail_sheet, source_row])
        activity = {
            "source_file_hash": manifests[1]["local_sha256"], "source_sheet": trail_sheet, "source_row": source_row,
            "source_identity_key": source_identity_key, "record_digest": "", "captured_at": manifests[1]["source_last_modified"],
            "source_customer_id_raw": identity["raw"], "source_customer_id_type": identity["type"],
            "source_customer_id_key": identity["key"], "company_name_raw": row_get(row, trail_positions, "客户(公司名称)"),
            "source_contact_name": row_get(row, trail_positions, "关联联系人昵称"),
            "source_contact_email": row_get(row, trail_positions, "关联联系人邮箱"),
            "activity_type_raw": raw_type, "activity_title_raw": raw_title, "activity_content_raw": raw_content or None,
            "activity_type": normalized_type, "activity_topic": topic, "channel": channel,
            "internal_related_link": row_get(row, trail_positions, "关联内容链接"),
            "internal_attachment_reference": row_get(row, trail_positions, "附件"),
            "owner_raw": row_get(row, trail_positions, "创建人"), "activity_at": activity_at,
            "source_created_at": timestamp(row_get(row, trail_positions, "创建时间")),
            "raw_source_row": raw_row(row, trail_headers),
        }
        activity["record_digest"] = digest_json({key: value for key, value in activity.items() if key not in {"record_digest", "raw_source_row"}})
        activity_rows.append(activity)
        activity_distribution[normalized_type] += 1

    customer_entities: list[dict[str, Any]] = []
    contact_entities: list[dict[str, Any]] = []
    latest_activity_by_key: dict[str, str] = {}
    for activity in activity_rows:
        activity_key = activity["source_customer_id_key"]
        latest_activity_by_key[activity_key] = max(latest_activity_by_key.get(activity_key, ""), activity["activity_at"])
    country_distribution: Counter[str] = Counter()
    status_distribution: Counter[str] = Counter()
    for key, grouped in sorted(customer_groups.items()):
        source_row, row, identity = grouped[0]
        company_names = {str(row_get(item[1], customer_positions, "公司名称") or "").strip() for item in grouped}
        if len(company_names) != 1 or not next(iter(company_names)):
            errors.append({"source": "customer", "source_customer_id_key": key, "reason": "COMPANY_IDENTITY_CONFLICT"})
            continue
        company_name = next(iter(company_names))
        country_raw = str(row_get(row, customer_positions, "国家地区") or "")
        country_code = COUNTRY_CODES.get(country_raw)
        if not country_code:
            errors.append({"source": "customer", "source_customer_id_key": key, "reason": "COUNTRY_MAPPING_REQUIRED"})
            continue
        status_raw = row_get(row, customer_positions, "客户状态")
        outcome_state, stage_detail = customer_stage(status_raw)
        customer_role = "HISTORICAL_OPEN_LEAD" if outcome_state == "OPEN" else "HISTORICAL_CRM_LEAD"
        customer_source_identity = digest_json(["OKKI", "CUSTOMER", key])
        customer = {
            "source_file_hash": manifests[0]["local_sha256"], "source_sheet": customer_sheet, "source_row": source_row,
            "source_identity_key": customer_source_identity, "record_digest": "", "captured_at": manifests[0]["source_last_modified"],
            "external_customer_id": key, "source_system": "OKKI", "source_customer_id_raw": identity["raw"],
            "source_customer_id_type": identity["type"], "source_customer_id_key": key,
            "company_name": company_name, "normalized_company_name": re.sub(r"[^0-9a-z]+", " ", company_name.casefold()).strip(),
            "country_code": country_code, "market_code": country_code, "buyer_type": row_get(row, customer_positions, "客户类型"),
            "company_size": row_get(row, customer_positions, "规模"), "address": row_get(row, customer_positions, "联系地址"),
            "website_url": row_get(row, customer_positions, "公司网址"), "website_domain": website_domain(row_get(row, customer_positions, "公司网址")),
            "customer_role": customer_role, "customer_type": row_get(row, customer_positions, "客户类型"),
            "channel_type": None, "product_profiles": [], "identity_resolution_status": "CONFIRMED",
            "crm_status_raw": status_raw, "crm_outcome_state": outcome_state, "crm_stage_detail": stage_detail,
            "crm_source_raw": row_get(row, customer_positions, "客户来源"), "crm_source_detail_raw": row_get(row, customer_positions, "来源详情"),
            "crm_owner_raw": row_get(row, customer_positions, "跟进人"), "crm_creator_raw": row_get(row, customer_positions, "创建人"),
            "crm_last_editor_raw": row_get(row, customer_positions, "最近修改人"), "short_name": row_get(row, customer_positions, "简称"),
            "city": row_get(row, customer_positions, "城市"), "province": row_get(row, customer_positions, "省份"),
            "crm_score_raw": row_get(row, customer_positions, "客户评分"), "customer_segment_raw": row_get(row, customer_positions, "客群"),
            "customer_tags": tags(row_get(row, customer_positions, "客户标签")), "purchase_intent_raw": row_get(row, customer_positions, "采购意向"),
            "company_notes": row_get(row, customer_positions, "公司备注"), "annual_purchase_raw": row_get(row, customer_positions, "年采购额"),
            "first_order_amount_raw": row_get(row, customer_positions, "首次成交订单金额(USD)"),
            "source_created_at": timestamp(row_get(row, customer_positions, "创建时间")),
            "profile_updated_at": timestamp(row_get(row, customer_positions, "资料更新时间")),
            "last_contact_at": timestamp(row_get(row, customer_positions, "最近联系时间")),
            "last_followup_at": timestamp(row_get(row, customer_positions, "最近跟进时间")),
            "last_edm_at": timestamp(row_get(row, customer_positions, "最近发EDM时间")),
            "historical_contacted": key in activity_customer_keys,
            "latest_crm_activity_at": latest_activity_by_key.get(key),
            "crm_profile": {
                "recent_activity_raw": row_get(row, customer_positions, "最近动态"),
                "recent_followup_raw": row_get(row, customer_positions, "最近跟进"),
                "contact_count_raw": row_get(row, customer_positions, "联系人数"),
            },
            "win_loss_coverage": "NONE", "dataset_role": "CRM_LEAD_HISTORY",
            "raw_source_row": raw_row(row, customer_headers),
        }
        customer["record_digest"] = digest_json({field: value for field, value in customer.items() if field not in {"record_digest", "raw_source_row"}})
        customer_entities.append(customer)
        country_distribution[country_code] += 1
        status_distribution[str(status_raw or "无")] += 1

        for contact_row_number, contact_row, contact_identity in grouped:
            email = row_get(contact_row, customer_positions, "邮箱")
            social = {header: row_get(contact_row, customer_positions, header) for header in SOCIAL_HEADERS if row_get(contact_row, customer_positions, header)}
            contact_source_identity = digest_json([manifests[0]["local_sha256"], customer_sheet, contact_row_number])
            contact = {
                "source_file_hash": manifests[0]["local_sha256"], "source_sheet": customer_sheet, "source_row": contact_row_number,
                "source_identity_key": contact_source_identity, "record_digest": "", "captured_at": manifests[0]["source_last_modified"],
                "source_customer_id_raw": contact_identity["raw"], "source_customer_id_type": contact_identity["type"],
                "source_customer_id_key": contact_identity["key"], "contact_name": row_get(contact_row, customer_positions, "主要联系人"),
                "job_title": row_get(contact_row, customer_positions, "职位"), "job_level": row_get(contact_row, customer_positions, "职级"),
                "business_email": email, "business_phone": row_get(contact_row, customer_positions, "联系电话"),
                "landline": row_get(contact_row, customer_positions, "座机"), "contact_notes": row_get(contact_row, customer_positions, "联系人备注"),
                "is_primary": boolean_value(row_get(contact_row, customer_positions, "主要联系人")),
                "is_generic_mailbox": bool(email and GENERIC_MAILBOX.match(str(email))), "social_profiles": social,
                "raw_source_row": raw_row(contact_row, customer_headers),
            }
            contact["record_digest"] = digest_json({field: value for field, value in contact.items() if field not in {"record_digest", "raw_source_row"}})
            contact_entities.append(contact)

    customer_keys = {item["source_customer_id_key"] for item in customer_entities}
    unmatched_activity_keys = sorted(activity_customer_keys - customer_keys)
    if unmatched_activity_keys:
        errors.append({"source": "trail", "reason": "UNMATCHED_CUSTOMER_IDS", "keys": unmatched_activity_keys})

    summary = {
        "customer_export_rows": len(customer_rows), "customers_detected": len(customer_entities), "contacts": len(contact_entities),
        "activity_rows": len(activity_rows), "activities": len(activity_rows), "outbound_marketing_emails": activity_distribution["OUTBOUND_MARKETING_EMAIL_SENT"],
        "followup_rows": activity_distribution["MANUAL_FOLLOW_UP"], "customers_with_activity": len(activity_customer_keys & customer_keys),
        "customers_without_activity": len(customer_keys - activity_customer_keys), "country_distribution": dict(sorted(country_distribution.items())),
        "crm_status_distribution": dict(sorted(status_distribution.items())), "activity_type_distribution": dict(sorted(activity_distribution.items())),
        "orders": 0, "products": 0, "outcomes": 0, "win_loss_coverage": "NONE", "error_count": len(errors), "warning_count": 0,
    }
    return {
        "batch_key": BATCH_KEY, "source_system": "OKKI", "data_classification": "INTERNAL_BUSINESS",
        "dry_run_passed": not errors and len(customer_entities) == 46 and len(contact_entities) == 248 and len(activity_rows) == 83,
        "errors": errors,
        "safety": {"source_files_modified": 0, "source_files_deleted": 0, "source_files_created": 0, "source_files_renamed": 0, "source_files_moved": 0},
        "source_files": manifests,
        "entities": {"HISTORICAL_CUSTOMERS": customer_entities, "HISTORICAL_CONTACTS": contact_entities, "HISTORICAL_ACTIVITIES": activity_rows},
        "summary": summary, "generated_at": utc_now(),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--customer", required=True)
    parser.add_argument("--trail", required=True)
    parser.add_argument("--staging", required=True)
    args = parser.parse_args()
    sources = [Path(args.customer).resolve(), Path(args.trail).resolve()]
    if any(not path.is_file() or path.suffix.casefold() != ".xlsx" for path in sources):
        raise RuntimeError("Both explicit OKKI XLSX source files are required")
    staging = Path(args.staging).resolve()
    staging.mkdir(parents=True, exist_ok=True)
    manifests = [stage_source(source, staging / "source-files", index) for index, source in enumerate(sources, start=1)]
    bundle = build_bundle(Path(manifests[0]["local_staging_path"]), Path(manifests[1]["local_staging_path"]), manifests)
    (staging / "staging-manifest.json").write_text(json.dumps(manifests, ensure_ascii=False, indent=2), encoding="utf-8")
    (staging / "okki-import-bundle.json").write_text(json.dumps(bundle, ensure_ascii=False, indent=2, default=json_value), encoding="utf-8")
    (staging / "summary.json").write_text(json.dumps(bundle["summary"], ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"batch_key": BATCH_KEY, "dry_run_passed": bundle["dry_run_passed"], **bundle["summary"]}, ensure_ascii=False))
    return 0 if bundle["dry_run_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
