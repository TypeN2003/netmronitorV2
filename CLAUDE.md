# CLAUDE.md

คู่มือสำหรับ Claude Code (และคนในทีม) เวลาแก้โปรเจกต์นี้ อ่านคู่กับ [README.md](README.md)

## โปรเจกต์คืออะไร

NetMonitor: เว็บเฝ้าระวังอุปกรณ์เครือข่ายและ AP ของคณะ เป็นโครงงานพิเศษ (ปริญญานิพนธ์) สาขา INET
ขอบเขตงานอ้างอิงจากเอกสาร **ทก.01** ข้อ 2.3 (2.3.1–2.3.10) ทุกฟีเจอร์ควรตรงกับข้อในเอกสารนี้

**เวอร์ชัน 2 = ต่อกับอุปกรณ์จริงแล้ว:** มี backend ใน `server/` ดึงข้อมูลผ่าน SNMP v2c/v3 จริง
เก็บใน SQLite ผ่าน Prisma ไม่มี mock data และไม่ใช้ `localStorage` เก็บข้อมูลอุปกรณ์อีกแล้ว
(เหลือแค่ธีม ภาษา และ JWT)
ยังไม่ทำ: RUCKUS One API, รับ Syslog UDP 514, ดึง Config ผ่าน SSH
(Telegram และอีเมลส่งจริงได้แล้ว)

## คำสั่ง

ต้องรันสองฝั่งพร้อมกัน

```bash
# ฝั่งเซิร์ฟเวอร์ (terminal 1)
cd server && npm run dev       # http://localhost:4000

# ฝั่งหน้าเว็บ (terminal 2)
npm run dev                    # http://localhost:3000 (proxy /api ไป 4000 ให้แล้ว)
```

ตรวจงานหลังแก้:

```bash
./node_modules/.bin/tsc --noEmit                 # type ฝั่ง frontend
./node_modules/.bin/vite build                   # build ผ่านไหม
cd server && npx tsc --noEmit -p tsconfig.json   # type ฝั่ง backend
cd server && bash scripts/smoke-test.sh          # ทดสอบ API 66 ข้อ (ต้องรัน fake-switch ก่อน)
cd server && node scripts/ui-check.mjs           # เปิดทุกหน้าใน Chrome headless แล้วรายงานที่พัง
```

**`scripts/ui-check.mjs`** ขับ Chrome ผ่าน DevTools Protocol (ใช้ WebSocket ที่มีใน Node 24
ไม่ต้องลง Playwright) ล็อกอินผ่านฟอร์มจริง เดินทุก route แล้วจับ:
uncaught exception, console.error, HTTP 4xx/5xx, **คีย์แปลที่หาย** (จะ render เป็นชื่อคีย์ดิบ),
**ค่าที่ hardcode ไว้สมัยข้อมูลจำลอง** และตรวจว่าหน้าที่ role นั้นไม่ควรเข้าได้ขึ้น 403 จริง
อ่าน role จาก `/api/auth/me` เอง จึงรันเทียบได้ทั้ง 3 สิทธิ์:

```bash
node scripts/ui-check.mjs                                                  # Admin
node scripts/ui-check.mjs http://localhost:3000 <engineer-email> <pass>    # Engineer
node scripts/ui-check.mjs http://localhost:3000 <viewer-email> <pass>      # Viewer
```

ถ้าหน้าไหนพัง ใช้ `node scripts/ui-probe.mjs /ports` ดูข้อความที่ render จริงทั้งหน้า
(ใน Git Bash ต้องใส่ `MSYS_NO_PATHCONV=1` ข้างหน้า ไม่งั้น `/ports` จะถูกแปลงเป็น path ของ Windows)

**ทดสอบโดยไม่มีอุปกรณ์จริง:** `cd server && node scripts/fake-switch.mjs`
สร้างสวิตช์ Cisco ปลอมที่พูด SNMP จริงบน udp/11611 (พอร์ต 8 มี CRC error, CPU เกินเกณฑ์)
เพิ่มในหน้าเว็บด้วย IP `127.0.0.1` พอร์ต SNMP `11611`

**npm install ฝั่ง frontend ต้องใช้ `--legacy-peer-deps`** เพราะ `package.json` ปิน `esbuild ^0.25`
แต่ `vite@8` ต้องการ `^0.27 || ^0.28` (ปัญหาเดิมของโปรเจกต์ `esbuild` ไม่ได้ถูก import ที่ไหนเลย
แก้จริงคือลบออกหรือ bump เป็น `^0.28.0`)

## โครงสร้างที่ต้องรู้

### ฝั่งเซิร์ฟเวอร์ (`server/`)

- `src/snmp/oids.ts`: OID ทั้งหมดที่ใช้ แยกตาม MIB + `detectVendor()` (อ่านยี่ห้อจาก `sysObjectID`)
- `src/snmp/client.ts`: หุ้ม `net-snmp` ให้เป็น Promise **`walk()` เขียน GETBULK loop เอง ไม่ใช้ `subtree()`**
  เพราะ `subtree()` ของ net-snmp ไม่เรียก callback เลยถ้า agent ตอบ `NoSuchObject` ที่ OID เดิม
  (เจอจริงตอนลองอ่าน OID ของ PoE ที่อุปกรณ์ไม่มี) loop นี้หยุดเมื่อออกนอก subtree /
  เจอ varbind error / OID ไม่เดินหน้า / เกิน deadline
- `src/snmp/collector.ts`: `pollDevice()` อ่านทุกอย่างในหนึ่ง session **ไม่ throw** คืน `{reachable:false, error}`
  ลอง vendor MIB ก่อน แล้ว fallback เป็น HOST-RESOURCES / ENTITY-SENSOR
- `src/services/poller.ts`: รอบการดึงข้อมูล คำนวณ Mbps จากผลต่าง counter, สร้าง/ปิด Alert,
  อัปเดตสถานะโหนด Topology, ตัดข้อมูลเก่า **หนึ่งรอบต่อครั้ง** (`cycleInFlight`) ไม่งั้น delta จะเพี้ยน
- `src/routes/*.ts`: REST API แยกตามหมวด กันสิทธิ์ด้วย `requireOperator` / `requireAdmin` / `requirePermission`
- `src/services/serialize.ts`: แปลง row เป็น JSON ให้ตรงกับ `src/types/index.ts` เป๊ะ
  **BigInt ต้องไม่หลุดออกไป** (`JSON.stringify` จะ throw)
- `prisma/schema.prisma`: โครงสร้างตาราง แก้แล้วต้อง `npm run db:push`

### ฝั่งหน้าเว็บ (`src/`)

- `src/services/api.ts`: ที่เดียวที่คุยกับ backend เก็บ token ในตัวแปร + `setUnauthorizedHandler`
  (401 = เด้งออกไปหน้า Login) `subscribeToEvents()` คือ SSE
- `src/context/NetworkDataContext.tsx`: โหลด `/api/bootstrap` ครั้งเดียว แล้วอัปเดตจาก SSE
  มี interval สำรองเผื่อ SSE หลุด **ทุก mutation เรียก API ก่อน แล้วจึงอัปเดต state**
  ไม่อัปเดตแบบ optimistic เพราะหน้าจอต้องไม่โชว์สิ่งที่เซิร์ฟเวอร์ปฏิเสธ
  คืนค่าเป็น `{success, error}` ให้หน้าเอาไปแสดง
- `src/context/AuthContext.tsx`: ทุกฟังก์ชันเป็น `async` แล้ว (เมื่อก่อนเป็น sync)
  `isRestoringSession` = กำลังเช็ก token กับเซิร์ฟเวอร์ `ProtectedRoute` ต้องรอค่านี้
  ไม่งั้น refresh หน้าแล้วจะเด้งออก
- `src/components/devices/snmp-fields.tsx`: ฟอร์ม SNMP + ปุ่มทดสอบ ใช้ร่วมกันทั้งตอนเพิ่มและแก้อุปกรณ์
- `src/context/LanguageContext.tsx`: คำแปล `th` และ `en` **ทุกข้อความบนหน้าจอต้องผ่าน `t('key')` และต้องเพิ่มคีย์ทั้งสองภาษา**
  ถ้าคีย์หาย หน้าจอจะโชว์ชื่อคีย์ดิบ (เคยเกิดกับ `configImportTitle`, `backupManagerTitle`)
  เช็กคีย์ที่หายด้วยการ grep หา `t(` ทั้ง `src/` แล้วเทียบกับสองบล็อกในไฟล์นี้
- `src/types/index.ts`: ชนิดข้อมูลทั้งหมด ต้องตรงกับ `server/src/services/serialize.ts`
- `tools/ssh-handler/`: สคริปต์ Windows ให้ลิงก์ `ssh://` เปิด PuTTY (ตรวจรูปแบบลิงก์ก่อนส่งให้ PuTTY เสมอ)
- `docs/`: เอกสารนำเสนอ (.docx), รูป/PDF สไลด์,
  `NetMonitor_Installation_Guide.docx` / `.pdf` = คู่มือติดตั้งบน Ubuntu + Cloudflare Tunnel
  (คู่มือเก่าที่อ้างว่าเป็นภาษา C ใช้ไม่ได้กับโปรเจกต์นี้)

## ข้อตกลงในการแก้โค้ด

- **ข้อมูลอยู่ที่เซิร์ฟเวอร์:** อย่าเพิ่ม mock data หรือ `INITIAL_*` กลับมา ถ้าหน้าจอว่าง
  ให้แสดงข้อความอธิบาย (ดู `noDevicesYet`, `noTelemetryYet`) ไม่ใช่เติมตัวเลขปลอม
- **อย่าแสดงค่าที่ไม่มีที่มา:** ถ้า SNMP ตอบไม่ได้ ให้บอกตรง ๆ ว่าทำไม
  (ดู `missing` ใน `pollDevice`, `noProtocolBreakdown`, `noEffectYet`)
- **เวลา:** ใช้ `nowTimestamp()` (เวลาท้องถิ่น) ห้ามใช้ `toISOString()` ซึ่งเป็น UTC ช้ากว่าไทย 7 ชม.
  มีทั้งใน `src/context/NetworkDataContext.tsx` และ `server/src/utils/time.ts`
- **ID:** ใช้ `uid(prefix)` กัน ID ซ้ำ (ฝั่งเซิร์ฟเวอร์ใช้ `randomUUID`)
- **ความลับไม่ส่งออกจากเซิร์ฟเวอร์:** `serializeDevice` ไม่ส่ง community / auth key / priv key
  ส่งแค่ `canWriteSnmp` เป็น boolean ตอนแก้อุปกรณ์ ช่องรหัสจึงว่างเสมอ (ว่าง = ใช้ค่าเดิม)
- **กันสิทธิ์สามชั้น:** ซ่อนเมนูใน `Sidebar.tsx` + ครอบ `ProtectedRoute` ใน `App.tsx`
  + **กันที่ route ฝั่งเซิร์ฟเวอร์ด้วย** (ชั้นสุดท้ายนี้คือชั้นที่ bypass ไม่ได้)
- **ห้ามใช้ `useState` ตั้งค่าเริ่มต้นจากข้อมูลใน context:** ข้อมูลโหลดแบบ async
  ตอน render ครั้งแรก `devices`/`vlans`/`portsByDevice` ยังว่าง ค่าที่ตั้งไว้จะค้างผิดตลอด
  ต้องใช้ `useEffect` ที่มี dependency เป็นข้อมูลนั้นด้วย (เคยพลาดที่ `PortsPage` —
  หน้าพอร์ตว่างเปล่าเพราะ fallback ไปที่ id ของข้อมูลจำลองเดิม `dev-core-01`)
- **ไฟล์บางไฟล์เป็น CRLF** (เช่น `AccessPointsPage.tsx`) ถ้าแก้ด้วยสคริปต์ต้องจัดการ line ending
- **อย่าเพิ่มช่องตั้งค่าที่ไม่มีผลจริง** ผู้ใช้ขอให้ลบทุกช่องที่ไม่มีโค้ดใช้ค่า (ดูการตัดสินใจด้านล่าง)
- commit เฉพาะเมื่อผู้ใช้สั่ง, ไม่ commit `node_modules/`; ทำงานบน branch `ui-theme-topology-improvements` แล้วเปิด PR เข้า `main`
  (เครื่องนี้ไม่มี `gh` CLI ให้ส่งลิงก์ compare แบบกรอก title/body ไว้ให้ผู้ใช้กดเอง)

## สิทธิ์ผู้ใช้ (ตาม ทก. 2.3.6)

| | Admin | Engineer | Viewer |
|---|---|---|---|
| Dashboard, Topology, สถานะอุปกรณ์ | ✓ | ✓ | ดูอย่างเดียว |
| รายละเอียดอุปกรณ์ (CPU/RAM/Traffic/พอร์ต) | ✓ | ✓ | ซ่อน |
| Alerts, Ports, VLAN, Syslog, Statistics | ✓ | ✓ | ไม่เห็นเมนู + route ถูกกัน |
| สร้างอุปกรณ์จาก Config, Backup, SSH, Settings | ✓ | ✓ | – |
| ลบอุปกรณ์, Users | ✓ | – | – |

บัญชีทดสอบ: `admin@` / `engineer@` / `viewer@netmonitor.internal` รหัส `admin123` / `engineer123` / `viewer123`

## การตัดสินใจที่ผู้ใช้เลือกแล้ว (อย่าย้อนกลับโดยไม่ถาม)

- **แหล่งข้อมูล = SNMP v2c/v3 เท่านั้น** ผู้ใช้เลือกไม่เอา ICMP ping, Syslog listener, SSH backup
  และ Telegram จริงในรอบนี้ `pingMs` จึงเป็นเวลาตอบของ SNMP ไม่ใช่ ICMP
- **ไม่มีข้อมูลจำลอง** DB เริ่มว่าง มี seed แค่บัญชี Admin (+ อุปกรณ์ตัวอย่างถ้าตั้ง `SEED_DEVICE_IP`)
- **เพิ่มอุปกรณ์ได้ 2 ทาง:** ทดสอบ SNMP ผ่าน หรือมีไฟล์ Config อย่างน้อยหนึ่งอย่าง
  (เดิมบังคับต้องมี Config — ผ่อนลงเพราะอุปกรณ์จริงที่ยืนยันตัวตนด้วย SNMP แล้ว
  ไม่ควรต้องหาไฟล์ Config มาแปะก่อน)

- **ไม่มีผล = ลบ:** ลบช่องตั้งค่าที่ไม่ได้ใช้ไปแล้ว: ชื่อองค์กร, Gateway IP, Timezone, นโยบาย Backup อัตโนมัติ, MFA/2FA, Slack Webhook
- **ธีมเริ่มต้น = สว่าง**, **ภาษาเริ่มต้น = ไทย**, **หน้าแรก = Login** (ไม่มี auto-login)
- **SNMP Polling เริ่มต้น 300 วินาที (5 นาที)** เพื่อลด Traffic (ตามผลสัมภาษณ์ใน ทก. 2.4.6)
- **นำเข้า Config = สร้างอุปกรณ์ใหม่** (ไม่ใช่ deploy ลงอุปกรณ์เดิม); ปุ่ม "เพิ่มอุปกรณ์" แบบกรอกมือถูกแทนด้วยปุ่มไปหน้า Backup
- **Topology ไม่แสดงชั้น Access:** แสดงแค่ Internet → Firewall → Core → แถว Distribution (จัดกึ่งกลางใต้ Core)
- **อุปกรณ์ Offline จำลอง:** `Dist-SW-Library` (10.10.0.4) ใส่กลับทุกครั้งที่โหลด เพื่อใช้เดโม
- **พอร์ตเสีย = สีแดง:** พอร์ต 24 (CRC) และ 36 (err-disabled) ทุกสวิตช์; ส้ม = error เล็กน้อย; เทา = ไม่ได้เสียบ
- **Wi-Fi ใช้ RUCKUS One ของคณะ:** เมนู "จุดกระจายสัญญาณไร้สาย" เปิด URL จาก Settings ในแท็บใหม่
  (ฝัง iframe ไม่ได้ เพราะ RUCKUS One ส่ง `X-Frame-Options: DENY`) ค่าเริ่มต้น `https://asia.ruckus.cloud`
- **ไม่แสดงรหัสผ่านผู้ใช้ในตาราง Users** (แม้แต่ Admin)
- **Alert มี 3 ระดับ** (Critical/Warning/Info) ส่วน Syslog ใช้ระดับตาม RFC 5424 ตั้งใจให้ต่างกัน
- **Alert แสดงภาษาไทยได้:** ใช้ฟิลด์ `categoryTh` / `messageTh` ผ่าน `alertText(alert, lang)`

## สิ่งที่เปลี่ยนตอนต่อ backend (รอบล่าสุด)

- ลบข้อมูลจำลองทั้งหมด: `INITIAL_DEVICES/PORTS/VLANS/ALERTS/SYSLOGS/APS`, `OFFLINE_DEMO_*`,
  `generateSwitchPorts`, `generateMockSha256`, `fluctuate`, `randomMac`
- ลบปุ่มสลับสิทธิ์ใน Header และปุ่ม quick-login ในหน้า Login (สิทธิ์มาจากบัญชีจริงแล้ว)
- ลบตัวเลขที่ไม่มีที่มา: "96.4% NOMINAL", "BGP 2/2 Established", "Peak 8.6 Gbps",
  กราฟแยกโปรโตคอล และตาราง Top Talkers ปลอมในหน้า Statistics
- กราฟ Dashboard/Statistics อ่านจาก `/api/telemetry/history` (ตาราง `TelemetrySample`)
- `pingTimeoutMs` ใช้งานจริงแล้ว (เป็น SNMP timeout), `snmpInterval` เปลี่ยนรอบได้ทันทีไม่ต้อง restart
- ปุ่มปิด/เปิดพอร์ตสั่ง SNMP SET จริง ถ้าไม่มี community ที่เขียนได้จะตอบ 400 พร้อมเหตุผล
- **โหมด production = พอร์ตเดียว** `server/src/app.ts` เสิร์ฟไฟล์จาก `dist/` ของโฟลเดอร์หลัก
  (ตั้ง path อื่นได้ด้วย `FRONTEND_DIST`) มี SPA fallback ให้ refresh ที่ `/devices` แล้วไม่ 404
  ตอน dev ไม่มีผลเพราะ Vite เสิร์ฟเอง — **CORS ย้ายไปครอบเฉพาะ `/api`** และอนุญาต origin
  ที่ตรงกับ host ของคำขอเสมอ (เดิมบล็อก origin ของตัวเอง ทำให้ asset ตอบ 500 ตอนเสิร์ฟพอร์ตเดียว
  และจะพังตอน deploy หลัง tunnel ด้วย)
- **อีเมลส่งจริงแล้ว** (`server/src/services/email.ts` ใช้ `nodemailer` ตั้งค่าสำหรับ Gmail App Password
  แต่เปลี่ยน host/port ไปใช้ SMTP อื่นได้) ตรรกะที่ใช้ร่วมกับ Telegram (ระดับความรุนแรง, คูลดาวน์, คิวส่ง)
  อยู่ใน `services/notify-policy.ts` ไม่ได้ copy-paste คูลดาวน์แยก key ต่อช่องทาง
  จึงตั้งคนละค่าได้ **App Password ไม่ถูก serialize กลับมา** (ว่าง = ใช้ค่าเดิม)
- **Telegram ส่งจริงแล้ว** (`server/src/services/telegram.ts` ใช้ `fetch` ที่มีใน Node ไม่ต้องลง SDK)
  ผูกกับ `raiseAlert()` และ `autoResolveAlerts()` ตั้งระดับ/คูลดาวน์/ปิดชั่วคราวได้ในหน้าตั้งค่า
  ปุ่ม "ทดสอบ Webhook" ส่งจริงและรายงานสิ่งที่ Telegram ตอบ (เดิมขึ้น toast ว่าสำเร็จโดยไม่ได้ส่งอะไร)
  **Bot token ไม่ถูก serialize กลับมาที่เบราว์เซอร์** เหมือน SNMP community (ว่าง = ใช้ค่าเดิม)
- หัวเว็บเคยโชว์ `GW: 10.10.0.1` ไฟเขียวตลอดกับ `0.8 ms` ตายตัว → เปลี่ยนเป็นอุปกรณ์ต้นทาง
  จริง (Router > Firewall > Core Switch) พร้อมสถานะและเวลาตอบ SNMP จริง
- แก้ป้ายที่ผิดหน่วย/ผิดเทคโนโลยี: หัวกราฟ Dashboard `(Gbps)` → `(Mbps)` ให้ตรงกับแกนและ API,
  การ์ด OFFLINE เขียน `ICMP unreachable` → `ไม่ตอบ SNMP`

## ทำอะไรไปแล้ว (ตามลำดับ commit)

1. `37fca73`: ปรับธีม, Topology, หน้า Login/สมัคร
2. `7d9ae1e`: เติมให้ตรง ทก.: การ์ดสถานะ Dashboard, คอลัมน์ Traffic, ค้นหาด้วยรุ่น, กรองสถานที่, Alert อัตโนมัติ + แจ้งเตือนในแอป,
   จำกัดสิทธิ์ Viewer, หน้าต่างนำเข้า Config 3 ขั้นตอน, ปุ่มแก้ไข Location/Rack, ธีมสว่างเป็นค่าเริ่มต้น
3. `3bed0bd`: หน้าแรกเป็น Login, session + "จดจำการเข้าระบบ"
4. `85b2bf5`: อุปกรณ์ Offline จำลอง, ลบชั้น Access ใน Topology, Alert ภาษาไทย, แก้บัค 20 จุด
   (persist syslog/VLAN/AP/พอร์ต, เวลา UTC, Warning ไม่หาย, Topology สีไม่ตรงอุปกรณ์, จำนวนพอร์ตไม่ตรง, Settings ทับ Backup ฯลฯ)
5. `0271b16`: สร้างอุปกรณ์จาก Config, ปุ่ม SSH (PuTTY), พอร์ตเสียสีแดง, RUCKUS One, การ์ด Dashboard กดได้, ลบช่องตั้งค่าที่ไม่มีผล
6. `80634c7`: เขียน README ใหม่

หลัง commit ล่าสุด (ยังไม่ commit ณ ตอนเขียนไฟล์นี้): ลบคอลัมน์รหัสผ่านในหน้า Users,
ซ่อนรายละเอียดอุปกรณ์และหน้า Alerts จาก Viewer ให้ตรง ทก. 2.3.6, ไฟล์สไลด์ `docs/slide-tools.png` / `.pdf`

## ที่ยังไม่ได้ทำ / ข้อจำกัดที่รู้อยู่

- **ยังไม่มีผลจริง:** Packet Loss threshold (SNMP วัดไม่ได้), Session Timeout (ของจริงคือ `JWT_EXPIRES_IN`)
  — ทั้งสองจุดมีป้ายบอกในหน้าจอแล้วว่ายังไม่มีผล
- **อุปกรณ์ที่ไม่เคยติดต่อได้เลยจะไม่สร้าง Alert "Device Unreachable"** เพราะ poller ยิงเฉพาะตอน
  *เปลี่ยน* สถานะเป็น offline และอุปกรณ์ที่เพิ่งสร้างเริ่มต้นเป็น offline อยู่แล้ว
  (ตั้งใจ: ใส่ IP ผิดตอนเพิ่มอุปกรณ์ไม่ควรเด้ง Alert วิกฤต — ดูสาเหตุได้ที่ `lastError` ของอุปกรณ์
  และที่การ์ดสถานะ Collector ในหน้าตั้งค่า)
- **ไม่ดึง Config เองได้:** ไม่ได้ล็อกอินเข้าอุปกรณ์ การสำรอง Config ต้องวาง/อัปโหลดไฟล์เข้ามา
  และ restore = ย้อนในฐานข้อมูล ยังต้องเอาไปใส่ที่อุปกรณ์เอง
- **PoE ต่อพอร์ตเป็นการเดา:** Cisco index ตาราง PoE ด้วย `group.port` ไม่ใช่ `ifIndex`
  โค้ดเดาจากชื่อพอร์ต (`Gi1/0/7` -> `1.7`) ถ้าแมปไม่ได้จะเป็น 0 W
- **ทราฟฟิกระดับอุปกรณ์ = ผลรวมทุกพอร์ต** จึงนับ traffic ที่วิ่งผ่านสวิตช์สองครั้ง
  (เข้าพอร์ตหนึ่ง ออกอีกพอร์ตหนึ่ง) เหมาะใช้ดูแนวโน้ม ไม่ใช่ตัวเลข WAN จริง
- **`npm audit` ฝั่ง server ขึ้น 3 high** มาจาก `deepmerge-ts` ใน Prisma CLI (dev-only, ยังไม่มีเวอร์ชันที่แก้)
  ไม่ได้อยู่ใน path ที่เซิร์ฟเวอร์รันตอน production
- **SQLite เขียนทีละตัว** งานขนาดคณะไหว ถ้าอุปกรณ์เยอะ (หลายร้อย) ควรย้ายไป PostgreSQL
- **ภาษาไทยยังไม่ครบทุกหน้า:** ยังมีข้อความภาษาอังกฤษพิมพ์ตรงในหลายหน้า (คำอธิบายใต้หัวข้อ, ป้ายในตาราง)
- **คู่มือนำเสนอ `docs/NetMonitor_Presentation_Guide.docx` ล้าสมัย:** ยังเขียนว่า Polling 30 วินาที, การ์ด AP บน Dashboard,
  นำเข้า Config แบบ deploy, Viewer ดู Alerts ได้
