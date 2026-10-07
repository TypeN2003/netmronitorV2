# NetMonitor

ระบบจัดการและเฝ้าระวังอุปกรณ์เครือข่ายและจุดกระจายสัญญาณไร้สายผ่านเว็บแอปพลิเคชัน
(Web-Based Network Device and Wireless Access Point Monitoring and Management System)

โครงงานพิเศษ สาขาวิชาวิศวกรรมสารสนเทศและเครือข่าย (INET) ภาควิชาเทคโนโลยีสารสนเทศ
คณะเทคโนโลยีและการจัดการอุตสาหกรรม มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าพระนครเหนือ

> **สถานะ: เวอร์ชัน 2 — ต่อกับอุปกรณ์จริงแล้ว**
> ข้อมูลทุกอย่างบนหน้าจอมาจากอุปกรณ์ที่ตอบ SNMP จริง เก็บในฐานข้อมูลฝั่งเซิร์ฟเวอร์
> สิ่งที่ยังไม่ทำ: ส่งแจ้งเตือน Telegram/Email จริง, ดึงข้อมูล AP จาก RUCKUS One API,
> รับ Syslog จากอุปกรณ์โดยตรง (ดู [ข้อจำกัด](#ข้อจำกัดของเวอร์ชันนี้))

## สถาปัตยกรรม

```
อุปกรณ์เครือข่ายจริง
   │  SNMP v2c / v3 (udp/161)
   ▼
server/  ── Collector + REST API ── SQLite
   │        Node.js + Express + Prisma
   │  HTTP /api  +  Server-Sent Events
   ▼
src/     ── หน้าเว็บ React + Vite
```

## เริ่มใช้งาน

ต้องมี [Node.js](https://nodejs.org) 20 ขึ้นไป ใช้สอง terminal

**Terminal 1 — เซิร์ฟเวอร์ (ดึงข้อมูลจากอุปกรณ์):**

```bash
cd server
npm install
cp .env.example .env     # แก้ JWT_SECRET ให้เป็นค่าสุ่มยาว ๆ
npm run setup            # สร้างฐานข้อมูล + บัญชี Admin แรก
npm run dev              # http://localhost:4000
```

**Terminal 2 — หน้าเว็บ:**

```bash
npm install
npm run dev              # http://localhost:3000
```

เปิด http://localhost:3000 — Vite จะส่ง `/api` ต่อไปที่เซิร์ฟเวอร์พอร์ต 4000 ให้เอง
ไม่ต้องตั้ง CORS หรือ URL อะไรเพิ่ม

รายละเอียดฝั่งเซิร์ฟเวอร์ทั้งหมดอยู่ใน [server/README.md](server/README.md)

### บัญชีผู้ใช้

ไม่มีบัญชีทดสอบแบบ hard-code อีกแล้ว บัญชีแรกเกิดจากอย่างใดอย่างหนึ่ง:

- `npm run setup` (หรือ `npm run db:seed`) ในโฟลเดอร์ `server` — จะพิมพ์อีเมล/รหัสผ่านออกมา
  ค่าเริ่มต้นคือ `admin@netmonitor.internal` / `admin123` **(เปลี่ยนก่อนใช้งานจริง:
  ตั้ง `SEED_ADMIN_PASSWORD` ใน `server/.env` ก่อนรัน seed)**
- กดสมัครสมาชิกจากหน้า Login — ผู้สมัครคนแรกได้สิทธิ์ Admin
  คนต่อ ๆ ไปได้ Engineer แล้ว Admin ปรับสิทธิ์ให้ในหน้า Users

รหัสผ่านเก็บเป็น bcrypt hash ฝั่งเซิร์ฟเวอร์ เบราว์เซอร์ถือแค่ JWT

### เพิ่มอุปกรณ์จริง

หน้า **Backup → นำเข้า Config / เพิ่มอุปกรณ์**: ใส่ IP, เลือก SNMP v2c หรือ v3,
กด **ทดสอบเชื่อมต่อ SNMP** แล้วระบบจะเติมยี่ห้อ/รุ่น/เฟิร์มแวร์/จำนวนพอร์ตจากที่อุปกรณ์ตอบมาเอง

ยังไม่มีอุปกรณ์จริง? มีสวิตช์ปลอมที่พูด SNMP จริงให้ทดสอบ:

```bash
cd server && node scripts/fake-switch.mjs
# แล้วเพิ่มอุปกรณ์ด้วย IP 127.0.0.1 พอร์ต SNMP 11611 community "public"
```

### คำสั่งอื่น

| คำสั่ง | ใช้ทำอะไร |
|---|---|
| `npm run build` | build หน้าเว็บสำหรับนำไปติดตั้ง (ผลอยู่ใน `dist/`) |
| `npm run preview` | เปิดดูผลจาก `npm run build` |
| `npm run lint` | ตรวจ type ด้วย TypeScript |
| `cd server && npm run db:studio` | เปิดดู/แก้ฐานข้อมูลด้วย Prisma Studio |
| `cd server && bash scripts/smoke-test.sh` | ทดสอบ API ทั้งหมด 66 ข้อ |

## ความสามารถ

| หน้า | สิ่งที่ทำได้ |
|---|---|
| **Dashboard** | จำนวนอุปกรณ์แยก Online / Warning / Offline (กดการ์ดเพื่อดูรายการ), กราฟ Traffic, Traffic ตาม VLAN, Alert ล่าสุด |
| **คลังอุปกรณ์ (Devices)** | ตารางอุปกรณ์พร้อม CPU, RAM, Uptime, Traffic เข้า/ออก, พอร์ต · ค้นหาด้วยชื่อ/IP/รุ่น/สถานที่ · กรองตามประเภท สถานะ สถานที่ · แก้ไขสถานที่/ตู้แร็ค · สำรอง Config · เปิด SSH ด้วย PuTTY |
| **สร้างอุปกรณ์จาก Config** | อัปโหลดไฟล์ `.cfg` / `.txt` (เช่น output ของ `show running-config`) ระบบอ่านชื่อ, IP, ผู้ผลิต, เวอร์ชัน OS แล้วสร้างอุปกรณ์พร้อมวางในผัง Topology |
| **พอร์ตสวิตช์ (Switch Ports)** | หน้าสวิตช์จำลอง สีบอกสถานะพอร์ต: เขียว = เชื่อมต่อ, แดง = พอร์ตเสีย (CRC Error / err-disabled), ส้ม = มีข้อผิดพลาดเล็กน้อย, เทา = ไม่ได้เสียบสาย · สั่งเปิด/ปิดพอร์ตได้ |
| **VLAN** | Traffic, Subnet, การใช้ DHCP ของแต่ละ VLAN · เพิ่ม VLAN |
| **จุดกระจายสัญญาณไร้สาย** | เปิด RUCKUS One ของคณะในแท็บใหม่ (ตั้ง URL ได้ในหน้าตั้งค่า) |
| **ผัง Topology** | ผังเครือข่ายตามลำดับชั้น สีตามสถานะอุปกรณ์จริง · ลากจัดตำแหน่ง, เพิ่ม/ลบอุปกรณ์, ลากสายเชื่อม, บันทึกผัง |
| **แจ้งเตือน (Alerts)** | Alert อัตโนมัติเมื่อ CPU ≥ 85% หรือ RAM ≥ 90% · แจ้งเตือนเด้งในแอปและบนเดสก์ท็อป · รับทราบ (ต้องเขียนบันทึก) → แก้ไขแล้ว |
| **บันทึกเหตุการณ์ (Syslog)** | Log ตามระดับ RFC 5424 · ค้นหา กรอง ส่งออก CSV |
| **สถิติ (Statistics)** | แบนด์วิดท์ 7 วัน, สัดส่วนโปรโตคอล, Top Talkers |
| **ผู้ใช้ (Users)** | สร้าง/ลบผู้ใช้, กำหนดสิทธิ์ (เฉพาะ Admin) |
| **ตั้งค่า (Settings)** | ภาษา, ลิงก์ RUCKUS One, รอบ SNMP Polling (ค่าเริ่มต้น 5 นาที), Telegram/Email, คลังไฟล์สำรอง Config (ดู เปรียบเทียบ ดาวน์โหลด กู้คืน) |

ทุกหน้าสลับภาษาไทย/อังกฤษ และธีมสว่าง/มืดได้

### สิทธิ์ผู้ใช้

| ความสามารถ | Admin | Engineer | Viewer |
|---|---|---|---|
| Dashboard, Topology, สถานะอุปกรณ์ (Online / Warning / Offline) | ✓ | ✓ | ดูอย่างเดียว |
| รายละเอียดอุปกรณ์ (CPU, RAM, Traffic, พอร์ต) | ✓ | ✓ | – |
| Alerts, พอร์ต, VLAN, Syslog, สถิติ | ✓ | ✓ | – |
| สร้างอุปกรณ์จาก Config, สำรอง Config, SSH | ✓ | ✓ | – |
| ลบอุปกรณ์, จัดการผู้ใช้ | ✓ | – | – |
| ตั้งค่าระบบ | ✓ | ✓ | – |

## ปุ่ม SSH (PuTTY)

ปุ่ม SSH ในหน้าคลังอุปกรณ์เปิดลิงก์ `ssh://<IP>` ต้องติดตั้งตัวเปิดลิงก์ครั้งเดียวต่อเครื่อง
โดยดับเบิลคลิก [`tools/ssh-handler/install.cmd`](tools/ssh-handler/install.cmd)
รายละเอียดอยู่ใน [`tools/ssh-handler/README.md`](tools/ssh-handler/README.md)

## เทคโนโลยี

- [React 19](https://react.dev) + TypeScript
- [Vite](https://vite.dev)
- [Tailwind CSS 4](https://tailwindcss.com)
- [Recharts](https://recharts.org) สำหรับกราฟ
- [Lucide](https://lucide.dev) สำหรับไอคอน
- React Router

## โครงสร้างโปรเจกต์

```
src/
├── pages/            หน้าต่างๆ (Dashboard, Devices, Topology, ...)
│   └── auth/         Login, สมัครสมาชิก, ลืม/ตั้งรหัสผ่านใหม่
├── components/
│   ├── layout/       Header, Sidebar, การแจ้งเตือนในแอป
│   ├── devices/      หน้าต่างสร้างอุปกรณ์จาก Config
│   └── settings/     คลังไฟล์สำรอง Config
├── context/
│   ├── NetworkDataContext.tsx   ข้อมูลอุปกรณ์ทั้งหมด, การดึงข้อมูลตามรอบ, Alert อัตโนมัติ
│   ├── AuthContext.tsx          Login และสิทธิ์ผู้ใช้
│   ├── LanguageContext.tsx      คำแปลไทย/อังกฤษ
│   └── ThemeContext.tsx         ธีมสว่าง/มืด
└── types/            ชนิดข้อมูล
tools/ssh-handler/    สคริปต์ให้ลิงก์ ssh:// เปิดด้วย PuTTY บน Windows

server/               Collector + REST API (ดู server/README.md)
├── prisma/
│   ├── schema.prisma         โครงสร้างฐานข้อมูล
│   └── seed.ts               สร้างบัญชี Admin แรก
├── scripts/
│   ├── fake-switch.mjs       สวิตช์ปลอมที่พูด SNMP จริง (ทดสอบไม่ต้องมีอุปกรณ์)
│   └── smoke-test.sh         ทดสอบ API ทั้งหมด
└── src/
    ├── snmp/                 ตัวดึงข้อมูล: OID, session, แปลงค่าเป็นตัวเลข
    ├── services/             รอบการดึงข้อมูล, Alert, Event log, Settings
    ├── routes/               REST API แยกตามหมวด
    └── middleware/           ตรวจ token และสิทธิ์
```

## ข้อจำกัดของเวอร์ชันนี้

- **ไม่ได้ล็อกอินเข้าอุปกรณ์:** คุยกับอุปกรณ์ผ่าน SNMP เท่านั้น จึงดึง `show running-config` เองไม่ได้
  การสำรอง Config ใช้ไฟล์ที่วาง/อัปโหลดเข้ามา และ "ย้อน Config" คือย้อนในฐานข้อมูล
  ยังต้องเอาไปใส่ที่อุปกรณ์เอง
- **ไม่มีการแยกทราฟฟิกตามโปรโตคอล:** ตัวนับ SNMP บอกได้แค่ปริมาณข้อมูล ไม่บอกว่าเป็น HTTPS/VoIP/อะไร
  ถ้าต้องการต้องเพิ่ม NetFlow/IPFIX หรือ DPI หน้า Statistics จึงไม่แสดงกราฟนี้
- **ยังไม่ส่งแจ้งเตือนออกนอกแอป:** ช่องตั้งค่า Telegram/Email เก็บค่าไว้ แต่ยังไม่มีโค้ดส่งจริง
- **ยังไม่รับ Syslog จากอุปกรณ์:** log ที่เห็นมาจากเหตุการณ์ที่ collector ตรวจพบและการกระทำของผู้ใช้
  ไม่ใช่ข้อความที่อุปกรณ์ส่งมาที่ UDP 514
- **ข้อมูล AP ยังว่าง:** Wi-Fi ของคณะใช้ RUCKUS One เมนู "จุดกระจายสัญญาณไร้สาย" จึงเปิดคอนโซลคลาวด์ในแท็บใหม่
- **ไม่มี Packet Loss:** ใช้ SNMP ไม่ได้ใช้ ICMP จึงวัดไม่ได้ ช่องตั้งค่านี้ยังไม่มีผล
- **ใช้ SQLite:** พอสำหรับงานขนาดคณะ ถ้าจะขยายควรย้ายไป PostgreSQL (เปลี่ยน provider ใน `schema.prisma`)

## แผนเวอร์ชันถัดไป

- ดึงข้อมูล AP จาก RUCKUS One API
- ส่งแจ้งเตือนผ่าน Telegram Bot API และ Gmail SMTP
- รับ Syslog จริงจากอุปกรณ์ (UDP 514)
- ดึง Config อัตโนมัติผ่าน SSH เพื่อให้สำรอง Config ได้เองตามรอบ
- แยกทราฟฟิกตามโปรโตคอลด้วย NetFlow / IPFIX

## ผู้จัดทำ

- นาย วิทวัส แก้ววิเศษ
- นาย อนันต์ยศ สายวงษ์

อาจารย์ที่ปรึกษา: ผู้ช่วยศาสตราจารย์ ดร.ศรายุทธ ธเนศสกุลวัฒนา
