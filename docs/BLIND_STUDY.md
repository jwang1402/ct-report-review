# 四模型盲审部署与病例导入

系统使用一个网站、两个入口和独立账号。管理员进入 `#/admin` 查看模型、评分与进度。每位医生使用自己的账号进入 `#/doctor`。**所有医生评阅同一组 10 例，每例看到相同的 A–D 报告，以相同顺序显示；评分与评语按账号隔离。** 医生人数由研究团队决定，研究开始后仍可追加。

现有四模型包为每例保存了四篇双语报告。网站选取 `Reader01.zip` 的病例顺序和该病例的字母映射，冻结为全研究共用版本。字母所对应的模型可随病例变化。新研究默认编号 `BR4shared`，已有研究与历史评分继续使用原编号。

## 网站上线后，如何在浏览器里操作

1. 从[管理员入口](https://jwang1402.github.io/ct-report-review/#/admin)登录，进入 **Readers → Create a reader account**，为每位医生设置个人账号和密码。首位管理员由项目所有者在下方的「建立管理员账号」步骤中创建。
2. 在学校允许用于此研究的 Google Drive 中建一个专用空文件夹，常规访问权限选「受限」，给参与医生的 Google 账号授予可下载的「查看者」权限。仅分享影像文件夹，解盲包留在管理员电脑上。
3. 管理员打开 **Upload study** 的 Google Drive 选项。从本地 `C:\MediLLM-main\test\baseline\MORPH-CT\results` 选择研究包：

   | 页面字段 | 选择文件 |
   |---|---|
   | CT volumes | `External-Blind-Review-5Models\Reader_Images.zip` |
   | Anonymous reports | `External-Blind-Review-4Models-ZH\Reader01.zip` |
   | Model key | `External-Blind-Review-4Models-ZH\Coordinator_ONLY.zip` |

4. 点 **Verify files**，核对 10 例和 40 份报告。依次点 **Connect Google Drive → Choose folder → Upload and verify CTs**，选择上一步的受限文件夹。上传成功后，页面自动填入每例影像的链接。选择参与医生，点 **Publish study**。后台保存报告、分配关系和链接，影像存于 Drive。如果 Google 账号限制网页上传，也可在 Drive 手动上传 `External-Blind-Review-4Models-ZH\Web-Import-Local\Images` 中的十个文件，再将每例文件链接粘贴到网页。
5. 在管理员病例列表打开病例，可以修改病例显示名称或报告文本。医生提交这个病例的第一份评分后，该病例的报告会锁定。
6. 把同一个[医生入口](https://jwang1402.github.io/ct-report-review/#/doctor)发给所有医生，分别提供个人账号。医生点 **Open CT in Drive**，使用已获准的 Google 账号下载 CT，再点 **Open downloaded CT**。网页校验文件后，可在三个切面查看影像并为旁边的报告评分。新增医生时，在 Drive 给其影像读取权限，并在网站 **Readers** 建账号、点 **Assign cases**。管理员可从 **Results** 导出评分。

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

## 研究开始后增加医生

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
3. 部署成功后，管理员入口为 `https://jwang1402.github.io/ct-report-review/#/admin`，所有医生均从 `https://jwang1402.github.io/ct-report-review/#/doctor` 登录，各用自己的账号。管理员在结果页查看每人的评分与真实模型，核对病例数和分配数。
4. 本版本收集网页的 1–5 分及评语。如研究还收集重大漏报、无依据重要发现、侧别错误计数或同例偏好，可为每位医生单独复制一份来自 **Reader01** 的空白 CSV，并以账号区分回收文件，以保持字母与网页一致。

GitHub Pages 仅部署应用代码。研究包、临时 SQL、影像、解盲表均不应放进 `public`、GitHub Release、Issues 或公开 Drive 链接。如先前已通过其他渠道公开分发影像或映射，需要在原存储服务单独核查其共享权限。

## 可选：本地演练

可用虚构病例或获准在本机保存的研究包演练。初始化本地 D1 时使用同一个私有状态目录：

```powershell
$state = Join-Path $env:USERPROFILE '.ct-report-review-private\state'
wrangler d1 execute ct-report-reviews --config backend/wrangler.jsonc --local --persist-to "$state" --file backend/schema.sql
```

随后运行上面的账号和导入命令，省略 `--remote`；导入工具会使用这个本地目录。以 `wrangler dev --config backend/wrangler.jsonc --persist-to "$state"` 启动本地 Worker。另开终端，将 `VITE_REVIEW_API_URL` 设为本地 Worker 地址，运行 `npm ci` 和 `npm run dev`，从 `http://127.0.0.1:5173` 进入。线上部署、远程导入和本地演练各自使用独立存储。
