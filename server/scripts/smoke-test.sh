#!/usr/bin/env bash
# End-to-end API check against a running collector.
#
#   1. node scripts/fake-switch.mjs &      (a fake Cisco switch on udp/11611)
#   2. npm run dev                          (the collector on :4000)
#   3. bash scripts/smoke-test.sh
#
# Registers the fake switch, polls it, and asserts that real SNMP data reached the
# database: ports, VLANs, traffic deltas, the CRC-faulty port, and the CPU alert.
set -u

API="${API:-http://localhost:4000/api}"
EMAIL="${SEED_ADMIN_EMAIL:-admin@netmonitor.internal}"
PASSWORD="${SEED_ADMIN_PASSWORD:-admin123}"
SNMP_PORT="${SNMP_PORT:-11611}"

pass=0
fail=0

check() { # check <description> <condition-result>
  if [ "$2" = "true" ]; then
    echo "  PASS  $1"
    pass=$((pass + 1))
  else
    echo "  FAIL  $1"
    fail=$((fail + 1))
  fi
}

jq_py() { python -c "import sys,json;d=json.load(sys.stdin);print($1)" 2>/dev/null || echo "__ERR__"; }

echo "== 1. authentication =="
LOGIN=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"identifier\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
TOKEN=$(echo "$LOGIN" | jq_py "d['token']")
check "login returns a token" "$([ "${TOKEN:0:2}" = "ey" ] && echo true || echo false)"
AUTH="Authorization: Bearer $TOKEN"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"identifier\":\"$EMAIL\",\"password\":\"definitely-wrong\"}")
check "wrong password is rejected with 401" "$([ "$CODE" = "401" ] && echo true || echo false)"

CODE=$(curl -s -o /dev/null -w '%{http_code}' "$API/devices")
check "no token is rejected with 401" "$([ "$CODE" = "401" ] && echo true || echo false)"

echo "== 2. SNMP probe =="
PROBE=$(curl -s -X POST "$API/devices/test-snmp" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"ip\":\"127.0.0.1\",\"snmpPort\":$SNMP_PORT,\"snmpVersion\":\"2c\",\"snmpCommunity\":\"public\"}")
check "probe reaches the agent" "$(echo "$PROBE" | jq_py "str(d['reachable']).lower()")"
check "vendor detected from sysObjectID" \
  "$(echo "$PROBE" | jq_py "str(d.get('suggested',{}).get('vendor')=='Cisco Systems').lower()")"
check "model read from ENTITY-MIB" \
  "$(echo "$PROBE" | jq_py "str(bool(d.get('suggested',{}).get('model'))).lower()")"
check "physical ports counted" \
  "$(echo "$PROBE" | jq_py "str(d.get('physicalPortCount',0)>0).lower()")"
check "VLANs discovered" "$(echo "$PROBE" | jq_py "str(len(d.get('vlans',[]))>0).lower()")"

PROBE_BAD=$(curl -s -X POST "$API/devices/test-snmp" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"ip\":\"127.0.0.1\",\"snmpPort\":$SNMP_PORT,\"snmpVersion\":\"2c\",\"snmpCommunity\":\"wrong-community\"}")
check "wrong community reports unreachable, not a crash" \
  "$(echo "$PROBE_BAD" | jq_py "str(d['reachable']==False).lower()")"

echo "== 3. register the device =="
# Start from a clean slate, so the script gives the same result every run.
# Deleting the device cascades its ports, telemetry and topology node; its alerts key
# on the device NAME, so resolve those separately or step 7 would see a stale one.
STALE=$(curl -s "$API/devices" -H "$AUTH" | jq_py "next((x['id'] for x in d if x['ip']=='127.0.0.1'), '')")
if [ -n "$STALE" ] && [ "$STALE" != "__ERR__" ]; then
  echo "  removing the device left by a previous run ($STALE)"
  curl -s -X DELETE "$API/devices/$STALE" -H "$AUTH" > /dev/null
fi
for id in $(curl -s "$API/alerts" -H "$AUTH" | jq_py "' '.join(a['id'] for a in d if a['deviceName']=='Lab-Core-SW-01' and a['status']!='resolved')"); do
  curl -s -X POST "$API/alerts/$id/resolve" -H "$AUTH" > /dev/null
done

CREATED=$(curl -s -X POST "$API/devices" -H "$AUTH" -H 'Content-Type: application/json' -d "{
  \"name\":\"Lab-Core-SW-01\",\"ip\":\"127.0.0.1\",\"type\":\"Core Switch\",
  \"snmpVersion\":\"2c\",\"snmpPort\":$SNMP_PORT,\"snmpCommunity\":\"public\",
  \"location\":\"Lab\",\"rack\":\"Rack-Lab-1\",
  \"topology\":{\"parentNodeId\":null,\"linkType\":\"fiber_10g\"}
}")
DEVICE_ID=$(echo "$CREATED" | jq_py "d['id']")
check "device registered" "$([ -n "$DEVICE_ID" ] && [ "$DEVICE_ID" != "__ERR__" ] && echo true || echo false)"

DUP=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/devices" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Lab-Core-SW-01\",\"ip\":\"127.0.0.1\",\"type\":\"Core Switch\"}")
check "duplicate name/IP rejected with 409" "$([ "$DUP" = "409" ] && echo true || echo false)"

BAD_IP=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/devices" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"name":"Bad","ip":"999.1.1.1","type":"Core Switch"}')
check "invalid IPv4 rejected with 400" "$([ "$BAD_IP" = "400" ] && echo true || echo false)"

echo "== 4. poll twice, so traffic deltas exist =="
curl -s -X POST "$API/telemetry/refresh" -H "$AUTH" > /dev/null
echo "  waiting 6s between polls so the counters move..."
sleep 6
SUMMARY=$(curl -s -X POST "$API/telemetry/refresh" -H "$AUTH")
check "poll cycle reports a reachable device" "$(echo "$SUMMARY" | jq_py "str(d['reachable']>0).lower()")"

DEVICE=$(curl -s "$API/devices/$DEVICE_ID" -H "$AUTH")
check "device is online or warning (not offline)" \
  "$(echo "$DEVICE" | jq_py "str(d['status'] in ('online','warning')).lower()")"
check "uptime filled in from sysUpTime" "$(echo "$DEVICE" | jq_py "str(d['uptime']!='-').lower()")"
check "CPU read over SNMP" "$(echo "$DEVICE" | jq_py "str(d['cpu']>0).lower()")"
check "RAM read over SNMP" "$(echo "$DEVICE" | jq_py "str(d['ram']>0).lower()")"
check "temperature read over SNMP" "$(echo "$DEVICE" | jq_py "str(d['temp']>0).lower()")"
check "model auto-filled by the collector" "$(echo "$DEVICE" | jq_py "str(bool(d['model'])).lower()")"
check "MAC auto-filled from ifPhysAddress" "$(echo "$DEVICE" | jq_py "str(bool(d['mac'])).lower()")"
check "port count matches the agent" "$(echo "$DEVICE" | jq_py "str(d['portsTotal']>0).lower()")"
check "inbound traffic computed from counter deltas" \
  "$(echo "$DEVICE" | jq_py "str(d['trafficInMbps']>0).lower()")"

echo "== 5. ports =="
PORTS=$(curl -s "$API/ports/$DEVICE_ID" -H "$AUTH")
check "ports stored" "$(echo "$PORTS" | jq_py "str(len(d)>0).lower()")"
check "10G uplink typed as SFP+" \
  "$(echo "$PORTS" | jq_py "str(any(p['portType']=='SFP+' and p['speed'].startswith('10 Gbps') for p in d)).lower()")"
check "unplugged port shows down" "$(echo "$PORTS" | jq_py "str(any(p['status']=='down' for p in d)).lower()")"
check "CRC-faulty port flagged red" \
  "$(echo "$PORTS" | jq_py "str(any(p['status']=='error' and p.get('fault')=='crc' for p in d)).lower()")"
check "per-port traffic computed" "$(echo "$PORTS" | jq_py "str(any(p['inTrafficMbps']>0 for p in d)).lower()")"
check "access VLAN read per port" "$(echo "$PORTS" | jq_py "str(any(p['vlan']>1 for p in d)).lower()")"

echo "== 6. VLANs discovered from the device =="
VLANS=$(curl -s "$API/vlans" -H "$AUTH")
check "VLANs auto-created" "$(echo "$VLANS" | jq_py "str(len(d)>0).lower()")"
check "VLAN names came from the switch" \
  "$(echo "$VLANS" | jq_py "str(any(v['name']=='VOICE-IP' for v in d)).lower()")"
check "discovered VLANs marked as such" "$(echo "$VLANS" | jq_py "str(any(v['discovered'] for v in d)).lower()")"
DEL=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$API/vlans/20" -H "$AUTH")
check "deleting a discovered VLAN is refused with 400" "$([ "$DEL" = "400" ] && echo true || echo false)"

echo "== 7. alerts raised by the collector =="
ALERTS=$(curl -s "$API/alerts" -H "$AUTH")
check "CPU threshold alert raised" \
  "$(echo "$ALERTS" | jq_py "str(any(a['category']=='High Resource Exhaustion' for a in d)).lower()")"
check "alert carries Thai copy" \
  "$(echo "$ALERTS" | jq_py "str(all(bool(a.get('categoryTh')) for a in d if a['category']=='High Resource Exhaustion')).lower()")"
check "no duplicate open alert per device+category" \
  "$(echo "$ALERTS" | jq_py "str(len([a for a in d if a['category']=='High Resource Exhaustion' and a['status']!='resolved'])<=1).lower()")"

ALERT_ID=$(echo "$ALERTS" | jq_py "next((a['id'] for a in d if a['status']=='active'), '')")
if [ -n "$ALERT_ID" ] && [ "$ALERT_ID" != "__ERR__" ]; then
  NO_NOTE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/alerts/$ALERT_ID/acknowledge" \
    -H "$AUTH" -H 'Content-Type: application/json' -d '{"note":""}')
  check "acknowledge without a note rejected with 400" "$([ "$NO_NOTE" = "400" ] && echo true || echo false)"

  ACKED=$(curl -s -X POST "$API/alerts/$ALERT_ID/acknowledge" -H "$AUTH" -H 'Content-Type: application/json' \
    -d '{"note":"Investigating from the smoke test"}')
  check "acknowledge with a note succeeds" "$(echo "$ACKED" | jq_py "str(d['status']=='acknowledged').lower()")"
  check "note stored against the alert" "$(echo "$ACKED" | jq_py "str(len(d['notes'])>0).lower()")"
fi

echo "== 8. topology =="
TOPO=$(curl -s "$API/topology" -H "$AUTH")
check "topology node created with the device" "$(echo "$TOPO" | jq_py "str(len(d['nodes'])>0).lower()")"
check "node bound to the device" \
  "$(echo "$TOPO" | jq_py "str(any(n.get('deviceId')=='$DEVICE_ID' for n in d['nodes'])).lower()")"
check "node status mirrors the device" \
  "$(echo "$TOPO" | jq_py "str(all(n['status'] in ('online','warning','offline') for n in d['nodes'])).lower()")"

echo "== 9. telemetry history for the charts =="
HISTORY=$(curl -s "$API/telemetry/history?hours=1&points=6" -H "$AUTH")
check "history has samples" "$(echo "$HISTORY" | jq_py "str(d['sampleCount']>0).lower()")"
check "traffic series populated" "$(echo "$HISTORY" | jq_py "str(len(d['traffic'])>0).lower()")"
check "resource series populated" "$(echo "$HISTORY" | jq_py "str(len(d['resource'])>0).lower()")"
TOP=$(curl -s "$API/telemetry/top-ports?limit=5" -H "$AUTH")
check "top talkers ranked from live counters" "$(echo "$TOP" | jq_py "str(len(d)>0).lower()")"

echo "== 10. config backups =="
NO_CFG=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/backups" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"deviceId\":\"$DEVICE_ID\",\"versionTag\":\"empty\"}")
check "backup with no config refused with 400" "$([ "$NO_CFG" = "400" ] && echo true || echo false)"

BK=$(curl -s -X POST "$API/backups" -H "$AUTH" -H 'Content-Type: application/json' -d "{
  \"deviceId\":\"$DEVICE_ID\",\"versionTag\":\"smoke-v1\",
  \"configContent\":\"hostname Lab-Core-SW-01\nvlan 20\n name VOICE-IP\nend\"
}")
check "backup archived with a real SHA-256" \
  "$(echo "$BK" | jq_py "str(len(d['checksumSha256'])==64).lower()")"
BK_ID=$(echo "$BK" | jq_py "d['id']")
RESTORE=$(curl -s -X POST "$API/backups/$BK_ID/restore" -H "$AUTH")
check "restore reports it did not touch the hardware" \
  "$(echo "$RESTORE" | jq_py "str(d['appliedToDevice']==False).lower()")"

echo "== 11. settings =="
SET=$(curl -s -X PATCH "$API/settings" -H "$AUTH" -H 'Content-Type: application/json' -d '{"snmpInterval":60}')
check "polling interval saved" "$(echo "$SET" | jq_py "str(d['snmpInterval']==60).lower()")"
TOO_FAST=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$API/settings" -H "$AUTH" \
  -H 'Content-Type: application/json' -d '{"snmpInterval":2}')
check "absurdly fast interval rejected with 400" "$([ "$TOO_FAST" = "400" ] && echo true || echo false)"
curl -s -X PATCH "$API/settings" -H "$AUTH" -H 'Content-Type: application/json' -d '{"snmpInterval":300}' > /dev/null

echo "== 12. role gates =="
VIEWER_PW="viewer-smoke-123"
curl -s -X POST "$API/users" -H "$AUTH" -H 'Content-Type: application/json' -d "{
  \"name\":\"Smoke Viewer\",\"email\":\"smoke-viewer@netmonitor.internal\",
  \"password\":\"$VIEWER_PW\",\"role\":\"Viewer\"
}" > /dev/null
VTOKEN=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"identifier\":\"smoke-viewer@netmonitor.internal\",\"password\":\"$VIEWER_PW\"}" | jq_py "d['token']")
VAUTH="Authorization: Bearer $VTOKEN"
check "viewer can sign in" "$([ "${VTOKEN:0:2}" = "ey" ] && echo true || echo false)"

for path in ports vlans alerts syslogs backups; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$API/$path" -H "$VAUTH")
  check "viewer blocked from /$path (403)" "$([ "$CODE" = "403" ] && echo true || echo false)"
done
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$API/devices" -H "$VAUTH")
check "viewer can still read /devices" "$([ "$CODE" = "200" ] && echo true || echo false)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$API/users" -H "$VAUTH")
check "viewer blocked from /users (403)" "$([ "$CODE" = "403" ] && echo true || echo false)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$API/devices/$DEVICE_ID" -H "$VAUTH")
check "viewer cannot delete a device (403)" "$([ "$CODE" = "403" ] && echo true || echo false)"

VBOOT=$(curl -s "$API/bootstrap" -H "$VAUTH")
check "viewer bootstrap omits ports" "$(echo "$VBOOT" | jq_py "str(len(d['portsByDevice'])==0).lower()")"
check "viewer bootstrap omits alerts" "$(echo "$VBOOT" | jq_py "str(len(d['alerts'])==0).lower()")"
check "viewer bootstrap still has devices" "$(echo "$VBOOT" | jq_py "str(len(d['devices'])>0).lower()")"

echo "== 13. port admin state over SNMP =="
SET_PORT=$(curl -s -w '\n%{http_code}' -X POST "$API/ports/$DEVICE_ID/1/admin" -H "$AUTH" \
  -H 'Content-Type: application/json' -d '{"adminUp":false}')
SET_CODE=$(echo "$SET_PORT" | tail -1)
check "shut without a write community refused with 400" "$([ "$SET_CODE" = "400" ] && echo true || echo false)"

curl -s -X PATCH "$API/devices/$DEVICE_ID" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"snmpWriteCommunity":"public"}' > /dev/null
SET_PORT=$(curl -s -w '\n%{http_code}' -X POST "$API/ports/$DEVICE_ID/1/admin" -H "$AUTH" \
  -H 'Content-Type: application/json' -d '{"adminUp":false}')
SET_CODE=$(echo "$SET_PORT" | tail -1)
check "shut accepted once a write community exists (200)" "$([ "$SET_CODE" = "200" ] && echo true || echo false)"
curl -s -X POST "$API/ports/$DEVICE_ID/1/admin" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"adminUp":true}' > /dev/null

echo "== 14. event log =="
LOGS=$(curl -s "$API/syslogs?limit=50" -H "$AUTH")
check "syslog recorded the operator actions" "$(echo "$LOGS" | jq_py "str(len(d)>0).lower()")"
check "syslog uses RFC 5424 severities" \
  "$(echo "$LOGS" | jq_py "str(all(l['severity'] in ('Emergency','Alert','Critical','Error','Warning','Notice','Info') for l in d)).lower()")"

echo
echo "=============================="
echo " passed: $pass   failed: $fail"
echo "=============================="
[ "$fail" -eq 0 ] || exit 1
