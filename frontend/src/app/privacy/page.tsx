import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "隐私说明 — PhysLab Killer 2.0",
  description: "匿名化数据收集的范围、处理方式与关闭方式。",
};

const SECTIONS = [
  {
    title: "收集什么",
    body: "只在你主动勾选并同意后收集两项：生成报告时你已确认的实验数值，以及你自愿附上的原始记录表照片。不收集账号信息，不做行为画像，也不会因为你不参与而限制任何功能。",
  },
  {
    title: "怎么处理",
    body: "照片保存前会重新解码并重新编码，自动去掉拍摄时间、位置、设备等照片信息；原始照片存放在私有存储中，不会进入公开仓库。数值会按稳定的字段标识对齐，与照片一起用于改进表格识别。",
  },
  {
    title: "怎么关掉",
    body: "报告区的「匿名化数据收集 · 更改」可以随时关闭，关闭后不再上传任何内容。若已经上传过，可在生成报告后的提示里撤回，撤回会同时删除原图与由它生成的数据样本。",
  },
  {
    title: "本地记住什么",
    body: "浏览器只保存一个「同意 / 拒绝」的标记，用来避免反复询问，其中不含实验数据、照片或身份信息。清除浏览器数据后会重新询问一次。",
  },
] as const;

export default function PrivacyPage() {
  return (
    <div className="container-x max-w-3xl py-12 sm:py-16">
      <h1 className="text-3xl font-extrabold tracking-tight text-stone-900 sm:text-4xl">隐私说明</h1>
      <p className="mt-3 text-sm leading-relaxed text-stone-500">
        匿名化数据收集完全自愿，不参与不影响录入、识别、计算、绘图与报告下载。
      </p>

      <div className="mt-10 space-y-8">
        {SECTIONS.map((section) => (
          <section key={section.title}>
            <h2 className="text-lg font-bold tracking-tight text-stone-900">{section.title}</h2>
            <p className="mt-2 text-sm leading-7 text-stone-600">{section.body}</p>
          </section>
        ))}
      </div>

      <p className="mt-12 text-xs text-stone-400">
        其他问题可通过项目 issue 反馈。
        <Link href="/" className="ml-1 font-semibold text-indigo-600 hover:underline">返回首页</Link>
      </p>
    </div>
  );
}
