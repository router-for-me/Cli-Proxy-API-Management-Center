#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
version="${VERSION:-dev}"
out_dir="${OUT_DIR:-"${repo_root}/dist/native"}"
web_html="${WEB_HTML:-"${repo_root}/dist/index.html"}"
binary_name="cpa-manager"

if [ ! -f "${web_html}" ]; then
  echo "missing ${web_html}; run npm run build first" >&2
  exit 1
fi

mkdir -p "${repo_root}/bin/tmp/release"
work_dir="$(mktemp -d "${repo_root}/bin/tmp/release/native.XXXXXX")"
trap 'rm -rf "${work_dir}"' EXIT

rm -rf "${out_dir}"
mkdir -p "${out_dir}"

cp -R "${repo_root}/usage-service" "${work_dir}/usage-service"
cp "${web_html}" "${work_dir}/usage-service/internal/httpapi/web/management.html"

targets=(
  "linux amd64"
  "linux arm64"
  "darwin amd64"
  "darwin arm64"
  "windows amd64"
  "windows arm64"
)

for target in "${targets[@]}"; do
  read -r goos goarch <<<"${target}"
  package_name="${binary_name}_${version}_${goos}_${goarch}"
  package_dir="${work_dir}/${package_name}"
  exe_name="${binary_name}"

  if [ "${goos}" = "windows" ]; then
    exe_name="${binary_name}.exe"
  fi

  mkdir -p "${package_dir}"
  (
    cd "${work_dir}/usage-service"
    CGO_ENABLED=0 GOOS="${goos}" GOARCH="${goarch}" go build -trimpath -ldflags "-s -w" -o "${package_dir}/${exe_name}" ./cmd/cpa-manager
  )

  cp "${repo_root}/README.md" "${package_dir}/README.md"
  cp "${repo_root}/README_CN.md" "${package_dir}/README_CN.md"
  cp "${repo_root}/LICENSE" "${package_dir}/LICENSE"

  if [ "${goos}" = "windows" ]; then
    (
      cd "${work_dir}"
      zip -qr "${out_dir}/${package_name}.zip" "${package_name}"
    )
  else
    (
      cd "${work_dir}"
      tar -czf "${out_dir}/${package_name}.tar.gz" "${package_name}"
    )
  fi
done

(
  cd "${out_dir}"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum ./* > checksums.txt
  else
    shasum -a 256 ./* > checksums.txt
  fi
)
