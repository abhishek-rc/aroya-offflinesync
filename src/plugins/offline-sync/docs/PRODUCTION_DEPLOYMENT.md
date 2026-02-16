# 🚢 Production Deployment Guide

**Last Updated:** January 2026  
**Version:** 1.2

This guide explains how to deploy the Offline Sync system in production, where ships at sea connect to the master over the **internet** (not the same local network).

---

## 🌐 Production Architecture

### How It Works in Production

```
┌─────────────────────────────────────────────────────────────────┐
│  MASTER SYSTEM (On Land / Cloud)                                │
│                                                                  │
│  ┌──────────────┐         ┌──────────────┐                     │
│  │   Strapi     │◄───────►│    Kafka     │                     │
│  │   (Master)   │         │  (Docker)    │                     │
│  └──────────────┘         └──────┬───────┘                     │
│                                  │ Port 9092                    │
│                                  │ Public IP / VPN              │
└──────────────────────────────────┼──────────────────────────────┘
                                   │
                                   │ INTERNET CONNECTION
                                   │
┌──────────────────────────────────┼──────────────────────────────┐
│  SHIP AT SEA (Replica)           │                              │
│                                   │                              │
│  ┌──────────────┐                │                              │
│  │   Strapi     │────────────────┘                              │
│  │  (Replica)   │  Connects via Internet                        │
│  └──────────────┘  (Satellite/WiFi/Cellular)                    │
│                                                                  │
│  ✅ Works offline when internet is down                          │
│  ✅ Auto-syncs when internet restored                            │
└──────────────────────────────────────────────────────────────────┘
```

**Key Difference from Testing:**
- **Testing:** Same WiFi network (local IP like `192.168.1.100`)
- **Production:** Ships connect over internet (public IP, VPN, or cloud endpoint)

---

## 🎯 Production Deployment Options

### Option 1: Public IP Address (Simplest)

**Best for:** Small deployments, direct internet access

**How it works:**
- Master has a public IP address
- Kafka exposed on public IP
- Ships connect directly via public IP

**Setup:**

1. **Get Public IP:**
   ```bash
   # Check your public IP
   curl ifconfig.me
   # or visit: https://whatismyipaddress.com
   ```

2. **Update docker-compose.yml:**
   ```yaml
   KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://<PUBLIC_IP>:9092
   ```

3. **Configure Router/Firewall:**
   - Port forward 9092 to master's internal IP
   - Open port 9092 on router firewall

4. **Security:** ⚠️ **IMPORTANT** - Add SSL/TLS (see Security section below)

**Pros:**
- ✅ Simple setup
- ✅ Direct connection
- ✅ No VPN needed

**Cons:**
- ❌ Less secure (needs SSL/TLS)
- ❌ Exposed to internet
- ❌ Requires static IP or dynamic DNS

---

### Option 2: Cloud Hosting (Recommended)

**Best for:** Production deployments, scalability, reliability

**How it works:**
- Master hosted on cloud (AWS, Azure, GCP, DigitalOcean)
- Kafka on cloud infrastructure
- Ships connect to cloud endpoint

**Setup:**

1. **Deploy Master on Cloud:**
   ```bash
   # Example: AWS EC2, Azure VM, DigitalOcean Droplet
   # Install Docker and Strapi
   ```

2. **Update docker-compose.yml:**
   ```yaml
   KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://<CLOUD_PUBLIC_IP>:9092
   # or use domain name:
   KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka.yourdomain.com:9092
   ```

3. **Configure Cloud Firewall:**
   - AWS: Security Groups
   - Azure: Network Security Groups
   - GCP: Firewall Rules
   - Allow inbound port 9092

4. **Use Domain Name (Optional):**
   ```yaml
   # Use domain instead of IP
   KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka.yourdomain.com:9092
   ```

**Pros:**
- ✅ Reliable infrastructure
- ✅ Scalable
- ✅ Better security options
- ✅ Static IP available
- ✅ Monitoring and logging

**Cons:**
- ❌ Cloud costs
- ❌ Requires cloud account

---

### Option 3: VPN Connection (Most Secure)

**Best for:** Enterprise deployments, high security requirements

**How it works:**
- Master and ships connect via VPN
- Kafka accessible only through VPN
- Encrypted tunnel between all systems

**Setup:**

1. **Set up VPN Server:**
   - OpenVPN, WireGuard, or cloud VPN
   - Master connects to VPN
   - Ships connect to VPN

2. **Update docker-compose.yml:**
   ```yaml
   # Use VPN IP address
   KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://10.8.0.1:9092
   # (VPN internal IP)
   ```

3. **Configure VPN:**
   - All systems on same VPN network
   - Kafka accessible via VPN IP

**Pros:**
- ✅ Highly secure
- ✅ Encrypted communication
- ✅ Private network
- ✅ Access control

**Cons:**
- ❌ More complex setup
- ❌ Requires VPN infrastructure
- ❌ VPN connection needed

---

### Option 4: Reverse Proxy / Load Balancer

**Best for:** High availability, multiple masters

**How it works:**
- Kafka behind reverse proxy (Nginx, HAProxy)
- Ships connect to proxy endpoint
- Proxy forwards to Kafka

**Setup:**

1. **Set up Reverse Proxy:**
   ```nginx
   # Nginx example
   stream {
       upstream kafka_backend {
           server kafka1:9092;
           server kafka2:9092;
       }
       server {
           listen 9092;
           proxy_pass kafka_backend;
       }
   }
   ```

2. **Update docker-compose.yml:**
   ```yaml
   KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://proxy.yourdomain.com:9092
   ```

**Pros:**
- ✅ High availability
- ✅ Load balancing
- ✅ SSL termination
- ✅ Single endpoint

**Cons:**
- ❌ More complex
- ❌ Additional infrastructure

---

## 🔒 Security Configuration

### ⚠️ CRITICAL: Enable SSL/TLS for Production

**Never expose Kafka without encryption in production!**

### Option 1: Kafka SSL/TLS

**Update docker-compose.yml:**

```yaml
services:
  kafka:
    environment:
      # SSL Configuration
      KAFKA_LISTENERS: PLAINTEXT://0.0.0.0:9092,SSL://0.0.0.0:9093,CONTROLLER://0.0.0.0:9094
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://localhost:9092,SSL://<PUBLIC_IP>:9093
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: PLAINTEXT:PLAINTEXT,SSL:SSL,CONTROLLER:PLAINTEXT
      KAFKA_INTER_BROKER_LISTENER_NAME: SSL
      
      # SSL Certificates (generate or use existing)
      KAFKA_SSL_KEYSTORE_LOCATION: /var/private/ssl/kafka.server.keystore.jks
      KAFKA_SSL_KEYSTORE_PASSWORD: <password>
      KAFKA_SSL_KEY_PASSWORD: <password>
      KAFKA_SSL_TRUSTSTORE_LOCATION: /var/private/ssl/kafka.server.truststore.jks
      KAFKA_SSL_TRUSTSTORE_PASSWORD: <password>
      KAFKA_SSL_CLIENT_AUTH: required
      
    ports:
      - "9092:9092"  # Plaintext (for local)
      - "9093:9093"  # SSL (for external)
```

**Replica Configuration (.env):**
```env
KAFKA_BROKERS=<PUBLIC_IP>:9093
KAFKA_SSL_ENABLED=true
KAFKA_SSL_CA_LOCATION=/path/to/ca-cert
```

### Option 2: VPN (Recommended for Security)

Use VPN instead of exposing Kafka directly:
- All traffic encrypted
- No need for Kafka SSL
- Better access control

### Option 3: SASL Authentication

**Add authentication:**

```yaml
KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: SASL_SSL:SASL_SSL
KAFKA_SASL_ENABLED_MECHANISMS: PLAIN
KAFKA_SASL_MECHANISM_INTER_BROKER_PROTOCOL: PLAIN
```

**Replica Configuration:**
```env
KAFKA_SASL_MECHANISM=plain
KAFKA_SASL_USERNAME=kafka-user
KAFKA_SASL_PASSWORD=kafka-password
```

---

## 📋 Production Setup Checklist

### Master System

- [ ] **Infrastructure:**
  - [ ] Cloud server or server with public IP
  - [ ] Static IP address or domain name
  - [ ] Firewall configured (port 9092 or 9093)
  - [ ] SSL certificates (if using SSL)

- [ ] **Kafka Configuration:**
  - [ ] `KAFKA_ADVERTISED_LISTENERS` set to public IP/domain
  - [ ] SSL/TLS enabled (if not using VPN)
  - [ ] Authentication configured (SASL)
  - [ ] Auto-restart enabled (`restart: unless-stopped`)

- [ ] **Security:**
  - [ ] Firewall rules configured
  - [ ] SSL certificates installed
  - [ ] Authentication enabled
  - [ ] Regular security updates

- [ ] **Monitoring:**
  - [ ] Kafka monitoring setup
  - [ ] Log aggregation
  - [ ] Alerting configured

### Ship Systems (Replicas)

- [ ] **Configuration:**
  - [ ] `.env` configured with master's public IP/domain
  - [ ] SSL certificates installed (if using SSL)
  - [ ] Authentication credentials configured (if using SASL)

- [ ] **Network:**
  - [ ] Internet connectivity available
  - [ ] VPN connection (if using VPN)
  - [ ] Firewall allows outbound port 9092/9093

- [ ] **Testing:**
  - [ ] Can connect to master's Kafka
  - [ ] Heartbeat sends successfully
  - [ ] Sync operations work
  - [ ] Offline mode tested

---

## 🌍 Network Requirements

### Master System

**Inbound Ports:**
- `9092` (Plaintext) - For local connections
- `9093` (SSL) - For external connections (if using SSL)
- `443` (HTTPS) - For Strapi admin panel

**Outbound Ports:**
- All outbound (for updates, etc.)

### Ship Systems

**Inbound Ports:**
- `1337` (Strapi) - For local admin panel

**Outbound Ports:**
- `9092` or `9093` - To connect to master's Kafka
- `443` (HTTPS) - For general internet access

---

## 🔧 Configuration Examples

### Example 1: Cloud Deployment (AWS EC2)

**Master docker-compose.yml:**
```yaml
services:
  kafka:
    image: confluentinc/cp-kafka:7.5.0
    environment:
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://ec2-xx-xx-xx-xx.compute-1.amazonaws.com:9092
      # or use Elastic IP:
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://54.123.45.67:9092
    ports:
      - "9092:9092"
    restart: unless-stopped
```

**Ship .env:**
```env
KAFKA_BROKERS=ec2-xx-xx-xx-xx.compute-1.amazonaws.com:9092
# or
KAFKA_BROKERS=54.123.45.67:9092
```

### Example 2: Domain Name Setup

**Master docker-compose.yml:**
```yaml
KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka.yourdomain.com:9092
```

**Ship .env:**
```env
KAFKA_BROKERS=kafka.yourdomain.com:9092
```

**DNS Configuration:**
```
kafka.yourdomain.com  A  54.123.45.67
```

### Example 3: VPN Setup

**Master docker-compose.yml:**
```yaml
KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://10.8.0.1:9092
# (VPN internal IP)
```

**Ship .env:**
```env
KAFKA_BROKERS=10.8.0.1:9092
# (VPN internal IP)
```

---

## 🧪 Testing Production Setup

### Test 1: Connectivity from Ship

**From ship system:**
```bash
# Test basic connectivity
ping <MASTER_PUBLIC_IP>

# Test Kafka port
telnet <MASTER_PUBLIC_IP> 9092
# or
Test-NetConnection -ComputerName <MASTER_PUBLIC_IP> -Port 9092
```

### Test 2: Kafka Connection

**From ship system:**
```bash
# Test Kafka connection
kafka-broker-api-versions --bootstrap-server <MASTER_PUBLIC_IP>:9092
```

### Test 3: Strapi Connection

**Start replica and check logs:**
```
✅ Kafka producer connected (replica mode)
✅ Kafka consumer connected (replica mode)
💓 Heartbeat sent
```

---

## 🚨 Common Production Issues

### Issue 1: Connection Timeout

**Symptoms:**
- Ships cannot connect to master
- Connection timeout errors

**Solutions:**
1. Verify public IP is correct
2. Check firewall allows port 9092
3. Verify router port forwarding (if behind NAT)
4. Test connectivity: `telnet <PUBLIC_IP> 9092`

### Issue 2: Dynamic IP Changes

**Problem:** Public IP changes, breaking connections

**Solutions:**
1. Use static IP (cloud provider)
2. Use dynamic DNS (DDNS)
3. Use domain name with automatic DNS updates

### Issue 3: Firewall Blocking

**Problem:** Cloud firewall blocking connections

**Solutions:**
1. AWS: Check Security Groups
2. Azure: Check Network Security Groups
3. GCP: Check Firewall Rules
4. Add inbound rule for port 9092

### Issue 4: SSL Certificate Issues

**Problem:** SSL handshake failures

**Solutions:**
1. Verify certificates are valid
2. Check certificate paths
3. Verify certificate permissions
4. Test SSL connection: `openssl s_client -connect <IP>:9093`

---

## 📊 Monitoring Production

### Key Metrics to Monitor

1. **Kafka Metrics:**
   - Connection count
   - Message throughput
   - Lag per partition
   - Error rates

2. **Ship Metrics:**
   - Online/offline status
   - Queue size
   - Sync success rate
   - Last heartbeat time

3. **Network Metrics:**
   - Latency to ships
   - Connection stability
   - Bandwidth usage

### Monitoring Tools

- **Kafka:** Kafka Manager, Confluent Control Center
- **Strapi:** Custom dashboard, logs
- **Network:** Ping monitoring, connection tracking

---

## 🔄 Updating Production

### Rolling Updates

1. **Update Master:**
   - Deploy new version
   - Restart Kafka (ships will reconnect automatically)
   - Monitor for issues

2. **Update Ships:**
   - Ships can update independently
   - No downtime required
   - Auto-reconnect after update

### Zero-Downtime Deployment

- Use multiple Kafka brokers (cluster)
- Use load balancer
- Ships reconnect automatically

---

## 📝 Production Best Practices

1. **Security:**
   - ✅ Always use SSL/TLS or VPN
   - ✅ Enable authentication (SASL)
   - ✅ Regular security updates
   - ✅ Monitor for suspicious activity

2. **Reliability:**
   - ✅ Use cloud hosting for master
   - ✅ Enable auto-restart for Kafka
   - ✅ Monitor Kafka health
   - ✅ Backup configurations

3. **Performance:**
   - ✅ Monitor Kafka performance
   - ✅ Optimize batch sizes
   - ✅ Monitor network latency
   - ✅ Scale as needed

4. **Documentation:**
   - ✅ Document IP addresses
   - ✅ Document credentials (securely)
   - ✅ Document network topology
   - ✅ Keep runbooks updated

---

## 🎯 Summary

**For Production:**

1. **Master:** Deploy on cloud with public IP or VPN
2. **Ships:** Connect via internet using public IP/domain
3. **Security:** Use SSL/TLS or VPN
4. **Monitoring:** Set up monitoring and alerts
5. **Testing:** Test connectivity before deploying ships

**Key Difference from Testing:**
- Testing: Same network (local IP)
- Production: Internet connection (public IP/VPN)

**The system works the same way** - ships connect to master's Kafka, work offline when internet is down, and auto-sync when connection is restored!

**New Features:**
- ✅ Full i18n/locale support - each language syncs independently
- ✅ Locale-aware conflict detection - no false conflicts between different languages
- ✅ Master edit tracking - conflicts correctly attributed to admin vs ship edits

---

**Last Updated:** January 2026
**Version:** 1.2

**New in v1.2:**
- ✅ Full i18n/locale support for multi-language content
- ✅ Locale-aware conflict detection
- ✅ Master edit tracking for accurate conflict attribution

