from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple

import boto3
from botocore.exceptions import BotoCoreError, ClientError


def sanitize_filename(name: str) -> str:
    base = Path(name.strip()).name
    safe = re.sub(r"[^a-zA-Z0-9._-]", "_", base)
    if not safe or safe in {".", ".."}:
        raise ValueError("Invalid filename.")
    return safe if safe.endswith(".csv") else f"{safe}.csv"


class CloudStorageService:
    """Secure AWS S3 storage client (credentials via backend env vars only) with Local Simulation Mode."""

    def __init__(self, data_dir: Path) -> None:
        self.local_dir = (data_dir / "cloud_sim").resolve()
        self.local_dir.mkdir(parents=True, exist_ok=True)
        self.manifest_path = self.local_dir / "manifest.json"

        env_bucket = os.getenv("AWS_S3_BUCKET", "").strip()
        env_region = os.getenv("AWS_REGION", "us-east-1").strip() or "us-east-1"
        env_prefix = os.getenv("AWS_S3_PREFIX", "smart-meter-datasets/").strip()

        self.mode = "aws_s3" if (self.has_aws_credentials() and env_bucket) else "local_simulation"
        self.bucket = env_bucket or "smart-meter-local-sim-bucket"
        self.region = env_region
        self.prefix = env_prefix

    def has_aws_credentials(self) -> bool:
        return bool(os.getenv("AWS_ACCESS_KEY_ID", "").strip() and os.getenv("AWS_SECRET_ACCESS_KEY", "").strip())

    def _s3_client(self):
        if not self.has_aws_credentials():
            raise RuntimeError("AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are not configured on the server.")
        return boto3.client(
            "s3",
            region_name=self.region,
            aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID", "").strip(),
            aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY", "").strip(),
        )

    def _confined_path(self, filename: str) -> Path:
        safe = sanitize_filename(filename)
        target = (self.local_dir / safe).resolve()
        if not str(target).startswith(str(self.local_dir) + os.sep):
            raise ValueError("Path traversal blocked.")
        return target

    def _read_manifest(self) -> List[Dict[str, Any]]:
        if not self.manifest_path.exists():
            return []
        try:
            data = json.loads(self.manifest_path.read_text(encoding="utf-8"))
            return data if isinstance(data, list) else []
        except Exception:
            return []

    def _write_manifest(self, items: List[Dict[str, Any]]) -> None:
        self.manifest_path.write_text(json.dumps(items, indent=2), encoding="utf-8")

    def configure(self, mode: str | None = None, bucket: str | None = None, region: str | None = None, prefix: str | None = None) -> Dict[str, Any]:
        next_mode = mode or self.mode
        next_bucket = (bucket if bucket is not None else self.bucket).strip()
        next_region = (region if region is not None else self.region).strip() or "us-east-1"
        next_prefix = (prefix if prefix is not None else self.prefix).strip()
        if next_prefix and not next_prefix.endswith("/"):
            next_prefix += "/"

        if next_mode == "aws_s3" and not self.has_aws_credentials():
            raise ValueError("Cannot enable AWS S3 mode without backend AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.")

        self.mode = next_mode
        self.bucket = next_bucket
        self.region = next_region
        self.prefix = next_prefix
        return self.get_status()

    def get_status(self) -> Dict[str, Any]:
        creds = self.has_aws_credentials()
        files = self.list_files()
        last_upload = files[0]["uploaded_at"] if files else None
        if self.mode == "aws_s3":
            connected = creds and bool(self.bucket)
            msg = f'Connected to AWS S3 bucket "{self.bucket}" ({self.region}).' if connected else "AWS S3 credentials missing."
        else:
            connected = True
            msg = "Running in Local Simulation Mode (persisting CSV datasets in data/cloud_sim/)."
        return {
            "mode": self.mode,
            "aws_credentials_configured": creds,
            "bucket": self.bucket,
            "region": self.region,
            "prefix": self.prefix,
            "connected": connected,
            "stored_files_count": len(files),
            "last_upload_at": last_upload,
            "message": msg,
        }

    def upload_csv(self, filename: str, csv_text: str, record_count: int) -> Dict[str, Any]:
        safe = sanitize_filename(filename)
        payload = csv_text.encode("utf-8")
        uploaded_at = datetime.now(timezone.utc).isoformat()

        if self.mode == "aws_s3":
            if not self.has_aws_credentials() or not self.bucket:
                raise RuntimeError("AWS S3 upload blocked: backend credentials or bucket are missing.")
            try:
                client = self._s3_client()
                client.put_object(
                    Bucket=self.bucket,
                    Key=f"{self.prefix}{safe}",
                    Body=payload,
                    ContentType="text/csv; charset=utf-8",
                )
            except (BotoCoreError, ClientError) as exc:
                raise RuntimeError(f"AWS S3 upload failed: {exc}") from exc
            return {
                "key": safe,
                "filename": safe,
                "size_bytes": len(payload),
                "uploaded_at": uploaded_at,
                "storage_mode": "aws_s3",
                "record_count": record_count,
                "bucket": self.bucket,
            }

        target = self._confined_path(safe)
        target.write_bytes(payload)
        entry = {
            "key": safe,
            "filename": safe,
            "size_bytes": len(payload),
            "uploaded_at": uploaded_at,
            "storage_mode": "local_simulation",
            "record_count": record_count,
            "bucket": self.bucket,
        }
        manifest = [m for m in self._read_manifest() if m.get("key") != safe]
        manifest.insert(0, entry)
        self._write_manifest(manifest)
        return entry

    def list_files(self) -> List[Dict[str, Any]]:
        if self.mode == "aws_s3":
            if not self.has_aws_credentials() or not self.bucket:
                return []
            client = self._s3_client()
            resp = client.list_objects_v2(Bucket=self.bucket, Prefix=self.prefix or "")
            files = []
            for obj in resp.get("Contents", []):
                key = obj.get("Key", "")
                if not key.endswith(".csv"):
                    continue
                name = Path(key).name
                files.append(
                    {
                        "key": name,
                        "filename": name,
                        "size_bytes": int(obj.get("Size", 0)),
                        "uploaded_at": obj["LastModified"].astimezone(timezone.utc).isoformat(),
                        "storage_mode": "aws_s3",
                        "bucket": self.bucket,
                    }
                )
            return sorted(files, key=lambda f: f["uploaded_at"], reverse=True)

        valid = []
        for entry in self._read_manifest():
            try:
                if self._confined_path(entry["key"]).exists():
                    valid.append(entry)
            except Exception:
                continue
        return sorted(valid, key=lambda f: f["uploaded_at"], reverse=True)

    def retrieve_csv(self, key: str) -> Tuple[str, bytes]:
        safe = sanitize_filename(key)
        if self.mode == "aws_s3":
            client = self._s3_client()
            resp = client.get_object(Bucket=self.bucket, Key=f"{self.prefix}{safe}")
            return safe, resp["Body"].read()

        target = self._confined_path(safe)
        if not target.exists():
            raise FileNotFoundError(f'Dataset "{safe}" not found in local archive.')
        return safe, target.read_bytes()
