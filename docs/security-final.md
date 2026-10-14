# Security моделі және қалған шектеулер

## Threat model

Негізгі assets: account password hashes, refresh sessions, private portfolio/watchlist/alert data, provider/service credentials, canonical indexed rows және operational telemetry. Threat sources: anonymous API abuse, user B-нің user A resource ID-ін қолдануы, forged JWT/internal token, hostile provider/broker payload, same-origin XSS және қате deployment/restore configuration.

Explorer blockchain data және public realtime stream ашық деректер. Private dashboard data JWT және ownership талап етеді. Бұл application wallet private keys сақтамайды және transaction signing жүргізбейді.

## Password hashing

Password bcrypt арқылы hash болады; BCRYPT_ROUNDS default 12, accepted 10–14. Input кемінде 8 character, ең көбі 72 UTF-8 byte: multibyte truncation алдын ала reject болады. Email trim/lowercase, displayName және names bounded validation қолданады. Missing/wrong-password/inactive user login бір generic Invalid credentials жауабын береді. Duplicate registration existing policy бойынша 409.

Password complexity немесе breached-password service қосылған жоқ. Hashing cost brute-force limiter-мен толықтырылады; password raw value database пен telemetry-де сақталмайды.

## Access JWT және refresh sessions

JWT access/refresh secrets distinct, кемінде 32 bytes және placeholder емес болуы керек. HS256 algorithm allowlist, issuer, audience, type, UUID claims және expiry тексеріледі. Access default 15 minutes, refresh 30 days; maximum lifetimes bounded. JWT guard identity database-тен active user-ді тексереді.

Refresh raw token орнына SHA-256 hash сақталады. User row және session row transaction lock-ы rotation/logout-all-ды сериализациялайды. Rotation ескі token-ді revoke етіп, жаңа session row-ды сол family-де жасайды. Revoked token reuse family revocation-ды commit етеді, содан кейін 401 береді.

Logout family-ді, logout-all user refresh sessions-ін revoke етеді. Бұрынғы access JWT expiry-ге дейін жарамды болуы мүмкін; inactive user бірден reject болады. Access-token revocation list немесе MFA/password reset/email verification delivery бұл implementation-да жоқ.

## Browser session және XSS tradeoff

Access token memory-де; refresh token localStorage-де. Reload restore және supported browser Web Locks tab coordination бар. Logout/account switch generation guard late callbacks пен бұрынғы account mutation replay-ін шектейді.

Same-origin XSS localStorage refresh token-ді оқи алады. Static Next CSP inline scripts/styles-ті hydration үшін рұқсат етеді, сондықтан бұл nonce-based strict CSP емес. HttpOnly-cookie/BFF session architecture енгізілмеген. React text escaping, source/ABI text rendering, bounded decoders және external redirect rejection қолданылады; arbitrary source/ABI орындалмайды.

## Ownership және ID enumeration

Public body/query owner ID қабылдамайды: trusted userId JWT CurrentUser арқылы алынады. Portfolio, holdings, watchlist/items, alert/events reads және mutations repository SQL-де owner-пен scoped. Foreign/missing/archived portfolio бір 404 policy алады. UI gate backend authorization-ды алмастырмайды.

UUID, Ethereum address/hash, block number, pagination және decimal threshold тексеріледі. Public portfolio/watchlist names 1–100 trimmed characters. Page maximum 1,000,000, list limit maximum 100. PostgreSQL bigint block upper bound алдыңғы HTTP boundary-де тексеріледі; monetary JSON values strings болып қалады.

## Internal service token

Gateway Indexer/Portfolio request-іне x-internal-service-token орнатады. Guards бір exact header string-ті timingSafeEqual арқылы тексереді; missing, wrong, comma-joined немесе array duplicate header reject болады. Internal request redirects қабылданбайды.

Production Compose Indexer/Portfolio ports-ін host-қа ашпайды. Token shared symmetric credential, mTLS емес; оны rotate ету барлық үш service configuration-ын бірге жаңартуды талап етеді. Trusted Gateway userId assertion downstream ownership scope үшін қолданылады.

## Redis API limiter

Atomic Lua INCR + initial PEXPIRE + PTTL fixed window-ы бірнеше Gateway instance арасында quota бөліседі. Redis key finite bucket және SHA-256 client IP-ден тұрады; raw IP/user-controlled URL metric label болмайды. Counter expiration missing quota-ның тұрақты жиналуын шектейді.

| Setting | Development default | Production code default |
| --- | --- | --- |
| API_RATE_LIMIT_ENABLED | true | true |
| RATE_LIMIT_WINDOW_MS | 60000 | 60000 |
| RATE_LIMIT_AUTH_MAX | 60 | 20 |
| RATE_LIMIT_SEARCH_MAX | 120 | 120 |
| RATE_LIMIT_EXPENSIVE_MAX | 60 | 60 |
| RATE_LIMIT_REDIS_TIMEOUT_MS | 250 | 250 |

.env.example және .env.production.example explicit ENV мәндері code defaults-ті override етеді. Auth bucket POST login/register/refresh-ке ортақ; search бөлек; contract/trace/address/token detail expensive bucket-і бөлек. Rejection 429, Retry-After және remaining/reset headers береді. Fixed windows boundary-де қысқа burst болуы мүмкін; бұл distributed botnet немесе account-based abuse-тің толық шешімі емес.

Redis unavailable/timeout: login/register/refresh fail closed 503; public read fail open upstream-ға өтеді. Connection/command deadline соңында client force disconnect жасалады, lazy reconnect coalesced және cooldown bounded. Authentication availability осы choice арқылы Redis-ке тәуелді. API_RATE_LIMIT_ENABLED=false тек explicit operator/test policy болсын.

## Client IP және proxy trust

TRUST_PROXY=false default: X-Forwarded-For өздігінен trusted IP болмайды. Тек explicit loopback/linklocal/uniquelocal network list configuration қабылданады; true, arbitrary hop count немесе all-network trust қабылданбайды.

Оператор тек controlled proxy network-ін таңдап, edge proxy forwarded headers-ті overwrite ететінін қамтамасыз етуі керек. Public clients сол trusted network-тен тікелей Gateway-ге кіре алса broad network trust spoofing қаупін береді. Shared NAT users бір quota-ны бөлісуі мүмкін. WebSocket per-IP bound тікелей socket remote address қолданады.

## CORS, headers және request limits

WEB_ORIGIN бір exact HTTP(S) origin; wildcard, null, credentials/path/trailing slash configuration қабылданбайды. Origin бар request басқа origin болса 403. Native originless clients public HTTP қолдана алады; CORS authentication control емес. Preflight 204 және explicit methods/headers; credential cookies қолданылмайды, bearer Authorization қолданылады.

API header policy: nosniff, no-referrer, DENY frame, disabled camera/microphone/geolocation/payment және default-src none CSP. Web CSP self assets, configured API/WS connect origins, object none және frame-ancestors none қолданады; unsafe-eval тек development-та. HSTS max-age бір жыл тек NODE_ENV=production және SECURITY_HSTS_ENABLED=true болғанда қосылады; TLS жоқ localhost deployment үшін false қалсын.

Gateway JSON body default 65536 bytes, maximum configurable 1 MiB. Strict JSON parser compressed inbound JSON-ды қабылдамайды. Malformed/large/unsupported encoding жауаптары generic 400/413/415. Request telemetry parser мен rejection алдында қосылады, сондықтан x-request-id сақталады. Public 5xx response stack, SQL, credentials немесе upstream diagnostics шығармайды.

## Provider және messaging payloads

RPC/provider clients timeout, bounded retries/backoff/rate policies қолданады. Contract source, ABI және call trees көлемі/shape бойынша тексеріледі. Search destination known route allowlist арқылы ғана қолданылады. Gateway client redirects және excessive streamed upstream body-ді reject етеді.

Outbox мен Rabbit publisher confirms durable commit-ке сүйенеді; consumer idempotency repeat delivery-ді өңдейді. Ephemeral realtime queue public stream ғана, durable private notification емес. WebSocket exact Origin, total/per-IP clients, 1 KiB frames, message/buffer/heartbeat bounds қолданады. Originless socket тек public events алады.

## Telemetry redaction

Structured logger configured secrets, password/token/cookie/auth keys, JWT/bcrypt encodings және credential URLs-ті redact етеді. Request middleware body/cookie/raw query жазбайды. Span export raw SQL, Redis arguments, URL/header/body attributes-ті сүзеді. Metric labels finite allowlist және cardinality bound арқылы өтеді; raw IDs/email/address/IP labels жоқ.

Logs/traces әлі operational metadata және identifiers ұстай алады. Retention/access policy операторға тиесілі; sanitizer сыртқы барлық инфраструктура log-ын автоматты түрде sanitize етеді деп есептеуге болмайды. Production logs JSON; response-те private stack болмайды.

## Secrets және Docker

Secrets тек ignored .env/.env.production немесе deployment runtime environment арқылы берілсін. NEXT_PUBLIC variables browser-visible; provider keys/internal/JWT secrets онда болмауы керек. Production template secrets бос; URL құрамындағы passwords үшін URL-safe random hex ұсынылады.

Runtime applications non-root, read-only, capabilities dropped және no-new-privileges. Build stages runtime source/toolchain-ін бөлек ұстайды; .dockerignore ENV/log/archives/generated files-ті exclude етеді. Dependency ports private, API/Web bindings default localhost. Docker host/root және database administrator бәрібір trusted control plane болып қалады.

## Backup/restore және remaining limits

Archive files sensitive private data қамтуы мүмкін. Script checksum/manifest және restrictive creation modes қолданады, бірақ encrypted/off-host storage, schedule немесе key management қоспайды. Restore exact container/target confirmation мен pre-created empty application database талап етеді; nonempty target автоматты түрде overwrite/drop жасалмайды.

Internet deployment алдында operator TLS, network access, secret rotation, remote encrypted archives, restore drills және alert notification route-тарын configure етуі керек. Single-host setup HA/SLA кепілдігін бермейді. Security/integration results және барлық evidence [Phase 12 report](phase-12-production-hardening.md) ішінде; browser smoke full XSS/browser penetration testing емес.

