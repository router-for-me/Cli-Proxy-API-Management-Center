# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/lang/zh-CN/).

## [Unreleased]

### Added
- SQLite 使用量前端适配层（API client + React Hook + 数据适配器）
- MonitorPage / RequestLogs SQLite 双通道自动切换
- CLIProxyAPI SQLite 持久化提案文档

### Changed
- 剥离上游 fork 关系，独立为 CPA-Dashboard-kelen
- `release` 脚本改为标准 semver
- 统一超时常量为共享常量

### Removed
- `sync` 脚本（fork 同步功能已废弃）
- 孤儿文件 logo.jpg（无引用）
- Vite 模板残留 react.svg

## [1.7.36] - 2026-04-20

### Initial
- Fork 自 router-for-me/Cli-Proxy-API-Management-Center
- React 19 + TypeScript 5.9 + Vite 7 + SCSS Modules + zustand + i18next
