# NetMonitor Collector (backend)

เซิร์ฟเวอร์ที่ดึงข้อมูลจริงจากอุปกรณ์เครือข่ายผ่าน **SNMP v2c / v3** เก็บลง SQLite
แล้วเปิดเป็น REST API + Server-Sent Events ให้หน้าเว็บ NetMonitor ใช้

เขียนด้วย Node.js + Express + TypeScript + Prisma

---

## ติดตั้งครั้งแรก

```bash
cd server
npm install
cp .env.example .env     # แล้วแก้ JWT_SECRET ให้เป็นค่าสุ่มยาว ๆ
npm run setup            # prisma generate + สร้างฐานข้อมูล + สร้างบัญชี Admin
npm run dev              # ฟังที่ http://localhost:4000
```

`npm run setup` จะพิมพ์อีเมล/รหัสผ่านของบัญชี Admin แรกออกมา
(ค่าเริ่มต้น `admin@netmonitor.internal` / `admin123` — **เปลี่ยนก่อนใช้งานจริง**
โดยตั้ง `SEED_ADMIN_PASSWORD` ใน `.env` ก่อนรัน seed)

ฐานข้อมูลเป็นไฟล์เดียว: `server/prisma/netmonitor.db` ลบไฟล์นี้แล้ว `npm run setup` ใหม่ = เริ่มจากศูนย์

---

## เพิ่มอุปกรณ์จริง

ทำจากหน้าเว็บ: **Backup → นำเข้า Config / เพิ่มอุปกรณ์**

1. ใส่ IP ของอุปกรณ์
2. เลือก SNMP v2c (ใส่ community) หรือ v3 (ใส่ user + auth/priv key)
3. กด **ทดสอบเชื่อมต่อ SNMP** — ถ้าผ่าน ระบบจะเติม vendor / รุ่น / เฟิร์มแวร์ / จำนวนพอร์ต
   จากที่อุปกรณ์ตอบมาให้เอง
4. เลือกจุดที่เชื่อมบนแผนผัง แล้วกดสร้าง

หรือกำหนดอุปกรณ์แรกไว้ใน `.env` ก่อน seed:

```ini
SEED_DEVICE_IP="10.10.0.1"
SEED_DEVICE_NAME="Core-SW-01"
SEED_DEVICE_TYPE="Core Switch"
SEED_DEVICE_COMMUNITY="public"
```

### ต้องตั้งอะไรบนอุปกรณ์

ฝั่งอุปกรณ์ต้องเปิด SNMP ให้ IP ของเครื่องที่รัน collector อ่านได้ ตัวอย่าง Cisco IOS:

```
! อ่านอย่างเดียว (v2c)
snmp-server community <READ_ONLY_STRING> RO
! ถ้าจะสั่งปิด/เปิดพอร์ตจากหน้าเว็บด้วย ต้องมี RW แยกอีกตัว
snmp-server community <READ_WRITE_STRING> RW

! หรือ v3 ซึ่งปลอดภัยกว่า (แนะนำ)
snmp-server group NETMON v3 priv
snmp-server user netmonitor NETMON v3 auth sha <AUTH_KEY> priv aes 128 <PRIV_KEY>
```

> ไม่ต้องใส่ community ที่มีสิทธิ์เขียน ถ้าไม่ได้ใช้ปุ่มปิด/เปิดพอร์ต
> ค่าเริ่มต้นคือใช้สิทธิ์อ่านอย่างเดียว ซึ่งปลอดภัยกว่า

---

## ค่าที่ดึงมาได้จริง

| สิ่งที่แสดงบนหน้าจอ | มาจาก OID |
|---|---|
| ชื่อ / uptime / สถานที่ | `sysName`, `sysUpTime`, `sysLocation` |
| ยี่ห้อ | `sysObjectID` (เลข enterprise) หรือข้อความใน `sysDescr` |
| รุ่น / เฟิร์มแวร์ / S/N | ENTITY-MIB แถว chassis (`entPhysicalModelName`, `entPhysicalSoftwareRev`) |
| CPU | Cisco `cpmCPUTotal5minRev` / Aruba `hpSwitchCpuStat` / FortiGate `fgSysCpuUsage` / Juniper `jnxOperatingCPU` → ถ้าไม่มีใช้ `hrProcessorLoad` |
| หน่วยความจำ | `ciscoMemoryPool*` / `hpLocalMem*` / `fgSysMemUsage` → ถ้าไม่มีใช้ `hrStorage*` (แถวที่เป็น RAM) |
| อุณหภูมิ | `ciscoEnvMonTemperatureValue` / `fgHwSensorEntValue` → ถ้าไม่มีใช้ ENTITY-SENSOR-MIB |
| พอร์ต / ความเร็ว / duplex | IF-MIB + `ifHighSpeed` + EtherLike-MIB |
| ทราฟฟิกต่อพอร์ต | ผลต่างของ `ifHCInOctets` / `ifHCOutOctets` ระหว่าง 2 รอบ แล้วหารด้วยเวลา |
| พอร์ตเสีย (แดง) | `dot3StatsFCSErrors` เพิ่มขึ้นจากรอบก่อน = CRC, `cErrDisableIfStatusCause` = err-disabled |
| VLAN | Cisco `vtpVlanName` → ถ้าไม่มีใช้ `dot1qVlanStaticName` |
| VLAN ของแต่ละพอร์ต | Cisco `vmVlan` → ถ้าไม่มีใช้ `dot1qPvid` |
| MAC ที่ต่ออยู่ | `dot1qTpFdbPort` / `dot1dTpFdbPort` (เฉพาะพอร์ตที่เจอ MAC เดียว) |
| `pingMs` | เวลาตอบกลับของ SNMP (ไม่ได้ใช้ ICMP) |

**ค่าที่คำนวณไม่ได้จาก SNMP:** แยกตามโปรโตคอล (HTTPS/VoIP/…) ต้องใช้ NetFlow/IPFIX หรือ DPI
หน้า Statistics จึงไม่แสดงกราฟนี้ แทนที่จะเดาตัวเลขขึ้นมา

---

## สถานะอุปกรณ์กำหนดจากอะไร

| สถานะ | เงื่อนไข |
|---|---|
| `online` | ตอบ SNMP และ CPU < 85% และ RAM < 90% |
| `warning` | ตอบ SNMP แต่ CPU ≥ 85% หรือ RAM ≥ 90% |
| `offline` | ไม่ตอบ SNMP ภายในเวลาที่ตั้งไว้ (เครื่องดับ / UDP ถูกบล็อก / community ผิด) |

ตอนเปลี่ยนเป็น `offline` หรือเกินเกณฑ์ จะสร้าง Alert + Syslog ให้อัตโนมัติ
และจะปิด Alert เองเมื่ออุปกรณ์กลับมาปกติ (หนึ่ง Alert ต่อหนึ่งอุปกรณ์ต่อหนึ่งหมวด ไม่สร้างซ้ำทุกรอบ)

---

## ทดสอบโดยไม่มีอุปกรณ์จริง

มีสวิตช์ปลอมที่พูด SNMP จริง ๆ อยู่ใน `scripts/`:

```bash
node scripts/fake-switch.mjs          # udp/11611, community "public"
```

จำลองเป็น Cisco C9300 8 พอร์ต: พอร์ต 1 เป็น uplink 10G, พอร์ต 7 ไม่ได้เสียบ,
พอร์ต 8 มี CRC error เพิ่มขึ้นเรื่อย ๆ (ไว้ดูพอร์ตสีแดง) และ CPU สูงกว่าเกณฑ์ (ไว้ดู Alert)

เพิ่มในหน้าเว็บด้วย IP `127.0.0.1` และ **SNMP port `11611`**

แล้วรันชุดทดสอบ API ทั้งหมด (66 ข้อ):

```bash
bash scripts/smoke-test.sh
```

## แจ้งเตือนผ่าน Telegram

ตั้งค่าที่หน้า **ตั้งค่าระบบ → Webhooks** ใส่ Bot token กับ Chat id แล้วกด **ทดสอบ Webhook**
ปุ่มนี้ส่งข้อความจริงและรายงานสิ่งที่ Telegram ตอบกลับมา ถ้าผิดจะบอกว่าผิดตรงไหน

| ตั้งค่าได้ | ความหมาย |
|---|---|
| เปิดการแจ้งเตือน | ปิดชั่วคราวได้โดยไม่ต้องลบ token |
| ส่งตั้งแต่ระดับ | `info` = ทุก Alert, `warning` = Warning ขึ้นไป, `critical` = เฉพาะวิกฤต |
| แจ้งตอนกลับมาปกติ | ส่งข้อความเขียวตอนอุปกรณ์กลับมา / ลดลงต่ำกว่าเกณฑ์ |
| เว้นระยะส่งซ้ำ | เรื่องเดิมของอุปกรณ์เดิมจะไม่ส่งซ้ำภายใน N นาที กันอุปกรณ์ที่ขึ้น ๆ ลง ๆ ยิงรัว |

**Bot token ไม่ถูกส่งกลับมาที่เบราว์เซอร์** เพราะใครได้ไปก็คุมบอทได้ หน้าตั้งค่าจะแสดงช่องว่าง
พร้อมข้อความว่าเก็บไว้แล้ว ปล่อยว่าง = ใช้ค่าเดิม กรอกใหม่ = เปลี่ยน

ข้อควรรู้:

- บอทเริ่มแชทกับคนก่อนไม่ได้ ต้องทักบอทในแชทนั้นอย่างน้อยหนึ่งครั้งก่อน ไม่งั้น Telegram จะตอบ
  `chat not found`
- การส่งเป็นแบบ fire-and-forget: ถ้า Telegram ล่มหรือเน็ตไม่ออก รอบการดึงข้อมูลยังทำงานปกติ
  มีแค่บรรทัดเตือนใน log ของเซิร์ฟเวอร์
- ข้อความถูกจัดคิวห่างกันราว 1 วินาที เพราะ Telegram จำกัดราว 1 ข้อความ/วินาที ต่อหนึ่งแชท

## แจ้งเตือนทางอีเมล (SMTP)

ตั้งค่าที่หน้า **ตั้งค่าระบบ → Webhooks** ส่วน "แจ้งเตือนทางอีเมล" แล้วกด **ทดสอบส่งอีเมล**
ปุ่มนี้ส่งอีเมลจริงและรายงานสิ่งที่เซิร์ฟเวอร์เมลตอบกลับมา

ถ้าใช้ Gmail:

1. เปิดการยืนยันตัวตนสองขั้นของบัญชี Google ก่อน (ไม่เปิดจะสร้าง App Password ไม่ได้)
2. สร้าง App Password ที่ `myaccount.google.com/apppasswords`
3. กรอกค่าในหน้าเว็บ: บัญชีที่ใช้ส่ง = อีเมล Gmail, App Password = รหัส 16 ตัว
   (มีช่องว่างคั่นก็ได้ ระบบตัดให้เอง), เซิร์ฟเวอร์ = `smtp.gmail.com`, พอร์ต = `587`
4. ใส่อีเมลผู้รับ แล้วติ๊ก "เปิดการแจ้งเตือนทางอีเมล"

| ตั้งค่าได้ | ความหมาย |
|---|---|
| เปิดการแจ้งเตือนทางอีเมล | ปิดชั่วคราวได้โดยไม่ต้องลบรหัส |
| ส่งอีเมลตั้งแต่ระดับ | ค่าเริ่มต้น `warning` เพื่อไม่ให้อีเมลล้นกล่อง (Telegram แยกตั้งต่างหากได้) |
| แจ้งตอนกลับมาปกติ | ส่งอีเมลเขียวตอนอุปกรณ์กลับมา |
| เว้นระยะส่งซ้ำ | เรื่องเดิมของอุปกรณ์เดิมจะไม่ส่งซ้ำภายใน N นาที |

**App Password ไม่ถูกส่งกลับมาที่เบราว์เซอร์** เหมือน Bot token ของ Telegram
ปล่อยช่องว่าง = ใช้ค่าเดิม กรอกใหม่ = เปลี่ยน

ข้อควรรู้:

- พอร์ต 587 ใช้ STARTTLS ส่วน 465 ใช้ SSL ตั้งแต่ต้น ระบบเลือกโหมดให้เองตามเลขพอร์ต
- ถ้าเซิร์ฟเวอร์ถูกบล็อกขาออกพอร์ต 587 จะส่งไม่ได้ ต้องเปิดที่ไฟร์วอลล์
- Telegram กับอีเมลตั้งระดับและคูลดาวน์แยกกันได้ เช่น Telegram ส่งทุกระดับ อีเมลส่งเฉพาะวิกฤต

## ตรวจหน้าเว็บ

```bash
node scripts/ui-check.mjs          # Admin
node scripts/ui-check.mjs http://localhost:3000 <email> <password>   # ทดสอบสิทธิ์อื่น
```

เปิดทุกหน้าใน Chrome headless (ขับผ่าน DevTools Protocol ไม่ต้องลง Playwright) ล็อกอินผ่านฟอร์มจริง
แล้วรายงาน uncaught exception, console.error, HTTP 4xx/5xx, คีย์แปลที่หาย, ค่าที่ hardcode ไว้
และตรวจว่าหน้าที่สิทธิ์นั้นเข้าไม่ได้ขึ้น 403 จริง

ถ้าอยากดูข้อความทั้งหน้า: `node scripts/ui-probe.mjs /ports`

---

## คำสั่ง

```bash
npm run dev        # dev server + reload อัตโนมัติ
npm run build      # คอมไพล์เป็น dist/
npm start          # รันจาก dist/ (ใช้ตอน deploy)
npm run db:studio  # เปิด Prisma Studio ดู/แก้ฐานข้อมูล
npm run db:push    # อัปเดตโครงสร้างตารางตาม schema.prisma
npm run db:seed    # สร้างบัญชี Admin (รันซ้ำได้ ไม่ทับของเดิม)
npm run lint       # ตรวจ type
```

---

## API

ทุก endpoint ขึ้นต้นด้วย `/api` และต้องมี `Authorization: Bearer <token>` ยกเว้นที่ระบุว่าไม่ต้อง

| Method | Path | สิทธิ์ | ทำอะไร |
|---|---|---|---|
| GET | `/health` | ไม่ต้อง | เช็กว่าเซิร์ฟเวอร์ยังอยู่ |
| POST | `/auth/login` | ไม่ต้อง | เข้าสู่ระบบ → `{ token, user }` |
| POST | `/auth/register` | ไม่ต้อง | สมัคร (คนแรกได้ Admin) |
| GET | `/auth/me` | ทุกคน | ข้อมูลบัญชีตัวเอง |
| POST | `/auth/forgot-password` | ไม่ต้อง | ขอรหัส OTP |
| POST | `/auth/reset-password` | ไม่ต้อง | ตั้งรหัสผ่านใหม่ด้วย OTP |
| POST | `/auth/change-password` | ทุกคน | เปลี่ยนรหัสผ่านตัวเอง |
| GET | `/bootstrap` | ทุกคน | ข้อมูลทั้งหมดสำหรับหน้าแรก (กรองตามสิทธิ์) |
| GET | `/devices` | ทุกคน | รายการอุปกรณ์ |
| POST | `/devices` | Admin, Engineer | เพิ่มอุปกรณ์ + วางบนแผนผัง |
| PATCH | `/devices/:id` | Admin, Engineer | แก้ข้อมูล / ค่า SNMP |
| DELETE | `/devices/:id` | Admin | ลบอุปกรณ์ |
| POST | `/devices/test-snmp` | Admin, Engineer | ทดสอบ SNMP กับ IP ที่ระบุ |
| POST | `/devices/:id/poll` | ทุกคน | ดึงข้อมูลอุปกรณ์นี้เดี๋ยวนี้ |
| GET | `/ports`, `/ports/:deviceId` | Admin, Engineer | สถานะพอร์ต |
| POST | `/ports/:deviceId/:portId/admin` | Admin, Engineer | สั่งปิด/เปิดพอร์ตจริงผ่าน SNMP SET |
| GET/POST/PATCH/DELETE | `/vlans` | Admin, Engineer | VLAN |
| GET | `/topology` | ทุกคน | โหนดและเส้นเชื่อม |
| POST/PATCH/DELETE | `/topology/nodes`, `/topology/links` | `canEditTopology` | แก้แผนผัง |
| PUT | `/topology/layout` | `canEditTopology` | บันทึกตำแหน่งทั้งหมด |
| GET | `/alerts` | Admin, Engineer | Alert |
| POST | `/alerts/:id/acknowledge` | `canAcknowledgeAlerts` | รับทราบ (ต้องมีหมายเหตุ) |
| POST | `/alerts/:id/resolve` | `canAcknowledgeAlerts` | ปิด Alert |
| GET | `/syslogs` | Admin, Engineer | Event log |
| GET/POST/DELETE | `/backups` | Admin, Engineer | สำรอง Config |
| POST | `/backups/:id/restore` | Admin, Engineer | ย้อน Config (ในระบบ ไม่ push ลงอุปกรณ์) |
| GET/PATCH | `/settings` | ทุกคน / `canModifySettings` | ตั้งค่าระบบ |
| POST | `/telemetry/refresh` | ทุกคน | ดึงข้อมูลทุกอุปกรณ์เดี๋ยวนี้ |
| GET | `/telemetry/status` | ทุกคน | สถานะ collector + ผลรอบล่าสุด |
| GET | `/telemetry/history` | ทุกคน | ข้อมูลย้อนหลังสำหรับกราฟ |
| GET | `/telemetry/top-ports` | Admin, Engineer | พอร์ตที่ใช้ทราฟฟิกมากสุด |
| GET | `/users` + CRUD | Admin | จัดการผู้ใช้ |
| GET | `/stream?token=...` | ทุกคน | Server-Sent Events (push ตอนดึงข้อมูลเสร็จ / มี Alert) |

ตัวอย่าง:

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"admin@netmonitor.internal","password":"admin123"}' | jq -r .token)

# ทดสอบ SNMP ก่อนเพิ่มอุปกรณ์
curl -s -X POST http://localhost:4000/api/devices/test-snmp \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"ip":"10.10.0.1","snmpVersion":"2c","snmpCommunity":"public"}' | jq

# ดึงข้อมูลทุกอุปกรณ์เดี๋ยวนี้
curl -s -X POST http://localhost:4000/api/telemetry/refresh \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

## การตั้งค่า (`server/.env`)

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `PORT` | `4000` | พอร์ตของ API |
| `DATABASE_URL` | `file:./netmonitor.db` | ไฟล์ SQLite (path อ้างจาก `server/prisma/`) |
| `CORS_ORIGIN` | `http://localhost:3000,...` | origin ที่เบราว์เซอร์เรียกได้ |
| `JWT_SECRET` | — | **ต้องตั้ง** กุญแจเซ็น token (สุ่มยาว ≥ 16 ตัว) |
| `JWT_EXPIRES_IN` | `12h` | อายุ session จริง |
| `SNMP_TIMEOUT_MS` | `4000` | เวลารอคำตอบ (ถูก override ด้วยค่าในหน้า Settings) |
| `SNMP_RETRIES` | `1` | ส่งซ้ำกี่ครั้งถ้าไม่ตอบ |
| `SNMP_CONCURRENCY` | `5` | ดึงพร้อมกันกี่อุปกรณ์ |
| `SNMP_COLLECT_FDB` | `true` | อ่านตาราง MAC เพื่อหา MAC ที่ต่อแต่ละพอร์ต (ปิดได้ถ้าสวิตช์ใหญ่) |
| `POLLER_ENABLED` | `true` | `false` = เปิด API แต่ไม่แตะเครือข่ายเลย |
| `CPU_ALERT_THRESHOLD` | `85` | เกณฑ์ CPU ที่ทำให้เป็น warning + สร้าง Alert |
| `RAM_ALERT_THRESHOLD` | `90` | เกณฑ์หน่วยความจำ |
| `TELEMETRY_RETENTION_HOURS` | `168` | เก็บข้อมูลกราฟย้อนหลังกี่ชั่วโมง |
| `SYSLOG_MAX_ROWS` | `5000` | เก็บ log ไม่เกินกี่แถว |

---

## ข้อควรรู้

- **ไม่ได้ล็อกอินเข้าอุปกรณ์** ระบบคุยกับอุปกรณ์ผ่าน SNMP เท่านั้น
  จึงดึง `show running-config` เองไม่ได้ — การสำรอง Config ใช้ไฟล์ที่วาง/อัปโหลดเข้ามา
  และการ "ย้อน Config" คือย้อนในฐานข้อมูล ยังต้องเอาไปใส่ที่อุปกรณ์เอง
- **สั่งปิด/เปิดพอร์ตได้จริง** ผ่าน SNMP SET บน `ifAdminStatus` แต่ต้องมี community/user ที่เขียนได้
  ถ้าไม่มี ระบบจะตอบ 400 พร้อมบอกเหตุผล ไม่ใช่แกล้งเปลี่ยนสีบนหน้าจอ
- **Telegram / อีเมล ยังไม่ส่งจริง** ค่าที่กรอกถูกเก็บไว้ แต่ยังไม่มีโค้ดส่ง
- **Wi-Fi (AP) มาจาก RUCKUS One** ตารางมีไว้รองรับ แต่ยังว่าง จนกว่าจะต่อ RUCKUS One API
- **ยังไม่มี Syslog listener (UDP 514)** log ที่เห็นมาจากเหตุการณ์ที่ collector ตรวจพบ
  และจากการกระทำของผู้ใช้ ไม่ใช่ข้อความที่อุปกรณ์ส่งมาเอง
