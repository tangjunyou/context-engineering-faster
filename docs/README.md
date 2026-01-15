# 文档入口

## 快速理解仓库
- 现状、问题清单与测试先行策略：[上下文工程项目现状分析与修复计划.md](file:///Users/jingshun/Desktop/上下文工程项目/docs/%E4%B8%8A%E4%B8%8B%E6%96%87%E5%B7%A5%E7%A8%8B%E9%A1%B9%E7%9B%AE%E7%8E%B0%E7%8A%B6%E5%88%86%E6%9E%90%E4%B8%8E%E4%BF%AE%E5%A4%8D%E8%AE%A1%E5%88%92.md)
- 规格到测试/CI 门禁映射：[验收与CI映射.md](file:///Users/jingshun/Desktop/上下文工程项目/docs/%E6%B5%8B%E8%AF%95%E6%96%87%E6%A1%A3/%E9%AA%8C%E6%94%B6%E4%B8%8ECI%E6%98%A0%E5%B0%84.md)

## 技术选型
- 桌面端分发（Tauri v2 + Sidecar）：[跨平台分发选型（Tauri Sidecar）.md](file:///Users/jingshun/Desktop/上下文工程项目/docs/%E6%8A%80%E6%9C%AF%E9%80%89%E5%9E%8B/%E8%B7%A8%E5%B9%B3%E5%8F%B0%E5%88%86%E5%8F%91%E9%80%89%E5%9E%8B%EF%BC%88Tauri%20Sidecar%EF%BC%89.md)
- Neo4j 连接器：[Neo4j 连接器落地要点（neo4rs）.md](file:///Users/jingshun/Desktop/上下文工程项目/docs/%E6%8A%80%E6%9C%AF%E9%80%89%E5%9E%8B/Neo4j%20%E8%BF%9E%E6%8E%A5%E5%99%A8%E8%90%BD%E5%9C%B0%E8%A6%81%E7%82%B9%EF%BC%88neo4rs%EF%BC%89.md)
- Milvus 连接器：[Milvus REST v2 连接器落地要点.md](file:///Users/jingshun/Desktop/上下文工程项目/docs/%E6%8A%80%E6%9C%AF%E9%80%89%E5%9E%8B/Milvus%20REST%20v2%20%E8%BF%9E%E6%8E%A5%E5%99%A8%E8%90%BD%E5%9C%B0%E8%A6%81%E7%82%B9.md)

## CI 分层
- PR 必跑：前端/后端/容器自检（[ci.yml](file:///Users/jingshun/Desktop/上下文工程项目/.github/workflows/ci.yml)）
- Nightly：Neo4j/Milvus 外部依赖集成（[nightly.yml](file:///Users/jingshun/Desktop/上下文工程项目/.github/workflows/nightly.yml)）
- Release：桌面端构建与产物归档（[release-desktop.yml](file:///Users/jingshun/Desktop/上下文工程项目/.github/workflows/release-desktop.yml)）

