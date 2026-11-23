# 盲审部署与病例导入

管理员通过密码进入 `#/admin`。公开研究的医生在 `#/radiologists` 输入姓名即可开始。Study A 的 10 例 CT 各有 3 份匿名报告 A–C，每份报告附从原文提取的 18 项结果。所有医生看到相同的报告顺序，分别为每份报告评分、登记错误。管理员可在 Results 中查看进度、解盲和导出。

源数据包保留每例四篇报告。Study A 按模型名称选取三篇，沿用各病例原有相对顺序，再编号为 A–C；字母对应的模型可随病例变化。Study A 的内部编号仍为 `BR4shared`。部署现有研究时先在 D1 执行 `backend/migrations/0007_study_a.sql`，再将核实过的报告文本哈希与 18 项提取值导入 `study_a_findings`。报告文本变更后须重新核对提取值才能提交该报告的评阅。

已部署 0007 的数据库须先执行一次 `backend/migrations/0008_study_a_reviewed_findings.sql`，再部署 Worker。新建数据库可直接使用 `backend/schema.sql`。协调员在私有种子文件中新建一个未激活的清单版本，按报告文本哈希和病灶名称填写原值与审核值，核对后在同一事务内激活。每个版本包含相对原始提取值的全部修订，发布后即固定。种子文件仅供协调员使用。新评阅显示当前版本，已提交的评阅继续显示当时的清单；管理员导出的 `checklist_version` 标明各评阅使用的版本，`radbert-raw` 表示初始清单。

## 网站上线后，如何在浏览器里操作

1. 从[管理员入口](https://jwang1402.github.io/ct-report-review/#/admin)登录。首位管理员由项目所有者在下方的「建立管理员账号」步骤中创建。
2. 为已获准公开分享的影像建立专用 Google Drive 文件夹，将常规访问权限设为「知道链接的任何人 · 查看者」，允许下载。文件夹只放匿名 CT，解盲包留在管理员电脑上。
3. 管理员打开 **Upload Case**。从本地 `C:\MediLLM-main\test\baseline\MORPH-CT\results` 选择研究包：

   | 页面字段 | 选择文件 |
   |---|---|
   | CT volumes | `External-Blind-Review-5Models\Reader_Images.zip` |
   | Anonymous reports | `External-Blind-Review-4Models-ZH\Reader01.zip` |
   | Model key | `External-Blind-Review-4Models-ZH\Coordinator_ONLY.zip` |

4. 点 **Verify files**，核对 10 例和 40 份报告，勾选 **These cases and reports are approved for public sharing**。依次点 **Connect Google Drive → Choose folder → Upload and verify CTs**。管理员授权自己的 Drive 后，选择上一步的文件夹。影像上传成功后自动填入链接，点 **Publish study**。网页用免登录方式核对影像内容后才会开放研究。如果 Google 账号限制网页上传，也可手动上传 `External-Blind-Review-4Models-ZH\Web-Import-Local\Images` 中的十份 CT，再粘贴文件链接。
5. 在管理员病例列表打开病例，可以修改病例显示名称或报告文本。医生提交这个病例的第一份评分后，该病例的报告会锁定。
6. 把同一个[医生入口](https://jwang1402.github.io/ct-report-review/#/radiologists)发给所有医生。填姓名后点 **Start review**，打开病例，网页自动读取 CT。医生可在三个切面查看影像并为旁边的报告评分。保存后刷新当前标签页可以继续，结束会话后不会通过输入姓名调出以往评分。管理员从 **Results** 按姓名查看或导出结果。

对仅向指定医生开放的研究，在 **Restricted study options** 中选择账号模式并使用受限 Drive 文件夹。管理员可从 `#/admin/readers` 分配账号，医生从 `#/radiologists/account` 登录。

以下步骤用于首次部署和命令行导入。日常上传、编辑和分配可使用上面的网页流程。

## 首次准备

在本机 Windows PowerShell 打开网站代码目录。需要 Python 3.11 以上、Node 22 以上、Wrangler 4，以及目标 Cloudflare 账号的 D1 和 Workers 部署权限。Drive 模式无需开通 R2。

```powershell
Set-Location 'C:\MediLLM-main\test\output\ct-report-review\ct-report-review-main'
if (-not (Test-Path '.\.wrangler\tools\node_modules\.bin\wrangler.cmd')) {
    npm.cmd install --prefix .wrangler/tools --no-save --package-lock=false --no-audit --no-fund wrangler@4
    if ($LASTEXITCODE -ne 0) { throw 'Wrangler 安装失败' }
}
Set-Alias wrangler (Resolve-Path '.\.wrangler\tools\node_modules\.bin\wrangler.cmd').Path
wrangler whoami
```

若显示尚未登录，运行 `wrangler login`，在浏览器登录原网站使用的 Cloudflare 账号，返回 PowerShell 再执行 `wrangler whoami`。上面的别名对当前窗口有效。

核对 `backend/wrangler.jsonc` 中的数据库 ID 和名称。常规部署只需名为 `DB` 的 D1 绑定。

### 准备评分数据库

现有网站已在 `backend/wrangler.jsonc` 配置了数据库。先执行只读查询，确认当前 Cloudflare 账号能打开该库。输出仅为表名。如提示找不到数据库，请核对账号和该配置中的数据库 ID。另建全新站点才需要 `wrangler d1 create ct-report-reviews` 并写入新 ID。

```powershell
wrangler d1 execute ct-report-reviews --config backend/wrangler.jsonc --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('reviews','accounts','shared_case_letters') ORDER BY name"
```

确认目标后运行下面一条命令。此版本的 `schema.sql` 使用 `CREATE ... IF NOT EXISTS` 补齐盲审表、索引和触发器。医生的新评分写入 `assignments`，历史评分继续由管理员只读查看。这里无需重跑早期用于重建旧评分表的 0001 脚本。

```powershell
wrangler d1 execute ct-report-reviews --config backend/wrangler.jsonc --remote --file backend/schema.sql
```

## 建立管理员账号

首次上线时在本机为管理员设置密码，终端输入时会隐藏。随后可在管理员网页创建医生账号。

```powershell
python scripts/prepare-blind-study.py user --remote --role admin --username coordinator
```

## 可选的命令行导入

病例 ZIP 和解盲包始终放在网站仓库之外。以下路径对应当前研究工作区；其他机器可改为实际位置。

```powershell
$results = 'C:\MediLLM-main\test\baseline\MORPH-CT\results'
$study = Join-Path $results 'External-Blind-Review-4Models-ZH'
$images = Join-Path $results 'External-Blind-Review-5Models\Reader_Images.zip'
python scripts/prepare-blind-study.py check --study-dir "$study" --images-zip "$images"
```

`check` 在本机核对压缩包哈希、病例配对、40 篇双语报告以及来自 Reader01 的 40 条共用字母映射。使用 Drive 时，在网页登记链接即可。仅针对另行启用私有 R2 的部署，在配置文件中添加 `r2_buckets`，将已有的私有桶绑定为 `IMAGES` 后，以下命令可以将影像存入该桶，并分配给首位医生。

```powershell
python scripts/prepare-blind-study.py import --remote --study-dir "$study" --images-zip "$images" --assign reader01
```

如需先准备材料，可省略 `--assign reader01`。如首批已有多位医生，只需为各人建立个人账号，再追加 `--assign reader02 --assign reader03` 等参数。上传中断时可以用相同命令重试。影像按内容哈希存入私有 R2，共用映射、模型报告和个人评分存入 D1。

## 私有研究开始后增加医生账号

例如追加第 2 至第 5 位医生，在网站仓库根目录运行以下 PowerShell 命令。把列表换成实际人员账号即可。账号已存在时，只运行该账号的 `assign` 命令。

```powershell
foreach ($name in 'reader02','reader03','reader04','reader05') {
    python scripts/prepare-blind-study.py user --remote --role doctor --username $name
    if ($LASTEXITCODE -ne 0) { break }
    python scripts/prepare-blind-study.py assign --remote --username $name
    if ($LASTEXITCODE -ne 0) { break }
}
```

`assign` 直接从 D1 读取已冻结的字母映射和病例顺序。新增任意数量医生都无需原始 ZIP 或重复上传 CT、报告。同一医生重复执行时，原分配和已提交的评分继续有效。若自行指定研究前缀，后续的 `import`、`assign` 均使用同一 `--prefix`。旧的独立随机化研究（例如 `BR4`）应保留原分配，新的共享顺序研究另用 `BR4shared`。

## 发布与核对

1. 从网站仓库根目录执行 `wrangler deploy --config backend/wrangler.jsonc`。核对部署输出中的 `DB`，记下 HTTPS Worker 地址。
2. 在 GitHub 仓库 Settings → Secrets and variables → Actions → Variables 中，将 `REVIEW_API_URL` 设为上述 Worker 地址（相同地址可沿用）。在 Settings → Pages 中确认 Source 为 GitHub Actions。当前本地目录已关联网站的 `main` 分支。从该目录运行下列命令，先核对即将提交的文件名，再提交代码。推送到 `main` 会自动触发 `Deploy CT Report Review`；在 GitHub 的 Actions 页面等待部署成功。

   ```powershell
   git add -- .github/workflows/deploy.yml .gitignore README.md 使用说明.md backend docs/BLIND_STUDY.md package.json package-lock.json scripts/prepare-blind-study.py scripts/test_prepare_blind_study.py src vite.config.ts
   git diff --cached --name-only
   ```

   ```powershell
   git commit -m "Separate blinded physician review from administrator results"
   git push origin main
   ```
3. 部署成功后，管理员入口为 `https://jwang1402.github.io/ct-report-review/#/admin`，所有医生共用 `https://jwang1402.github.io/ct-report-review/#/radiologists`。公开阅片只需姓名。管理员在结果页查看每人的评分与真实模型。
4. 本版本收集网页的 1–5 分及评语。如研究还收集重大漏报、无依据重要发现、侧别错误计数或同例偏好，可为每位医生单独复制一份来自 **Reader01** 的空白 CSV，并以账号区分回收文件，以保持字母与网页一致。

GitHub Pages 发布应用代码。解盲表、研究包和含报告的临时 SQL 留在管理员侧。公开 CT 使用专用的只读 Drive 文件夹；受限研究使用各自的私有文件夹。停止公开阅片后，可在 Drive 另行收回影像共享。

## 可选：本地演练

可用虚构病例或获准在本机保存的研究包演练。初始化本地 D1 时使用同一个私有状态目录：

```powershell
$state = Join-Path $env:USERPROFILE '.ct-report-review-private\state'
wrangler d1 execute ct-report-reviews --config backend/wrangler.jsonc --local --persist-to "$state" --file backend/schema.sql
```

随后运行上面的账号和导入命令，省略 `--remote`；导入工具会使用这个本地目录。以 `wrangler dev --config backend/wrangler.jsonc --persist-to "$state"` 启动本地 Worker。另开终端，将 `VITE_REVIEW_API_URL` 设为本地 Worker 地址，运行 `npm ci` 和 `npm run dev`，从 `http://127.0.0.1:5173` 进入。线上部署、远程导入和本地演练各自使用独立存储。
