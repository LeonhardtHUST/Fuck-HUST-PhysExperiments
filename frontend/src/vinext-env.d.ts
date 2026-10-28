/**
 * Next API 表面的类型来源。
 *
 * `next` 已从依赖中移除，`import type { Metadata } from "next"` / `next/link` /
 * `next/navigation` 的类型由 vinext 自带的 shim 包提供（`vinext/types` 指向
 * `@vinext/types`，内部是一组 `declare module "next*"` 的环境声明）。
 *
 * 不直接用 vinext 自动生成的 `next-env.d.ts`：那个文件每次 build/dev 都会被重写，
 * 并引用 `./.next/types/routes.d.ts`（Next Typed Routes 的产物），在本仓库并不存在。
 */
import "vinext/types";
