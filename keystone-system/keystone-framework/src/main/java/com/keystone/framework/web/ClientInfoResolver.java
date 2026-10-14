package com.keystone.framework.web;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.util.Enumeration;
import java.util.Locale;
import java.util.function.Supplier;

/**
 * 客户端信息解析：从当前 HTTP 请求采集 IP、登录地点、浏览器与操作系统。
 * 登录日志、操作日志等审计场景统一从这里取数，避免各业务模块重复实现。
 */
public final class ClientInfoResolver {

    /**
     * 客户端信息快照。
     *
     * @param ip       客户端 IP 地址（对应 sys_login_log.ip）
     * @param location 登录/操作地点（对应 sys_login_log.location，仅标注本机与内网）
     * @param browser  浏览器（对应 sys_login_log.browser）
     * @param os       操作系统（对应 sys_login_log.os）
     */
    public record ClientInfo(String ip, String location, String browser, String os) {
    }

    private static final ClientInfo EMPTY = new ClientInfo(null, null, null, null);

    private ClientInfoResolver() {
    }

    /**
     * 解析当前请求的客户端信息。无请求上下文（异步线程、定时任务、单元测试）时返回空快照，
     * 对应字段落库为 NULL，不抛异常。
     */
    public static ClientInfo current() {
        HttpServletRequest request = currentRequest();
        if (request == null) {
            return EMPTY;
        }
        String ip = resolveIp(request);
        String userAgent = request.getHeader("User-Agent");
        return new ClientInfo(ip, resolveLocation(ip), parseBrowser(userAgent), parseOs(userAgent));
    }

    /**
     * 客户端 IP：优先代理转发头（X-Forwarded-For 取第一段，跳过 unknown），其次 X-Real-IP，
     * 最后直连地址。结果为回环地址时（本机直连、或本机开发服务器代理转发），回退为本机网卡的
     * 真实地址——「本机访问」同样记录各台电脑自己的 IP，而不是千篇一律的 127.0.0.1。
     */
    public static String resolveIp(HttpServletRequest request) {
        if (request == null) {
            return null;
        }
        String ip = parseRawIp(request);
        if (ip == null || ip.isBlank()) {
            return localAddress();
        }
        String resolved = ip.trim();
        if (isLoopback(normalizeIp(resolved))) {
            String local = localAddress();
            if (local != null && !local.isBlank()) {
                return local;
            }
        }
        return resolved;
    }

    /** 原始解析链：X-Forwarded-For 第一段（跳过 unknown / 空段）→ X-Real-IP → 直连地址。 */
    private static String parseRawIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            for (String segment : forwarded.split(",")) {
                String candidate = segment.trim();
                if (!candidate.isEmpty() && !"unknown".equalsIgnoreCase(candidate)) {
                    return candidate;
                }
            }
        }
        String realIp = request.getHeader("X-Real-IP");
        if (realIp != null && !realIp.isBlank()) {
            return realIp.trim();
        }
        return request.getRemoteAddr();
    }

    /**
     * 登录/操作地点：本机（回环地址）标注「本机」，私有网段标注「内网」，公网地址暂留空，
     * 待后续接入 IP 地理库时在此扩展。
     */
    public static String resolveLocation(String ip) {
        if (ip == null || ip.isBlank()) {
            return null;
        }
        String normalized = normalizeIp(ip);
        if (isLoopback(normalized)) {
            return "本机";
        }
        if (isIntranet(normalized)) {
            return "内网";
        }
        return null;
    }

    /** 浏览器识别：覆盖常见桌面与移动浏览器，以及微信 / QQ 内置浏览器；无法识别返回 null。 */
    public static String parseBrowser(String userAgent) {
        if (userAgent == null || userAgent.isBlank()) {
            return null;
        }
        String ua = userAgent.toLowerCase(Locale.ROOT);
        if (ua.contains("micromessenger")) {
            return "微信";
        }
        if (ua.contains("qqbrowser")) {
            return "QQ浏览器";
        }
        if (ua.contains("edg/") || ua.contains("edge/")) {
            return "Edge";
        }
        if (ua.contains("opr/") || ua.contains("opera")) {
            return "Opera";
        }
        if (ua.contains("chrome/") || ua.contains("crios/")) {
            return "Chrome";
        }
        if (ua.contains("firefox/") || ua.contains("fxios/")) {
            return "Firefox";
        }
        if (ua.contains("safari/")) {
            return "Safari";
        }
        return null;
    }

    /** 操作系统识别：注意 HarmonyOS 需先于 Android 判断（兼容模式下其 UA 同时含两者）。 */
    public static String parseOs(String userAgent) {
        if (userAgent == null || userAgent.isBlank()) {
            return null;
        }
        String ua = userAgent.toLowerCase(Locale.ROOT);
        if (ua.contains("windows")) {
            return "Windows";
        }
        if (ua.contains("harmonyos") || ua.contains("openharmony")) {
            return "HarmonyOS";
        }
        if (ua.contains("android")) {
            return "Android";
        }
        if (ua.contains("iphone") || ua.contains("ipad") || ua.contains("ipod")) {
            return "iOS";
        }
        if (ua.contains("macintosh") || ua.contains("mac os x")) {
            return "macOS";
        }
        if (ua.contains("linux")) {
            return "Linux";
        }
        return null;
    }

    private static HttpServletRequest currentRequest() {
        if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes) {
            return attributes.getRequest();
        }
        return null;
    }

    /** IPv4-mapped IPv6（如 ::ffff:192.168.1.5）归一化为 IPv4，统一按 v4 规则判断。 */
    private static String normalizeIp(String ip) {
        String value = ip.trim().toLowerCase(Locale.ROOT);
        if (value.startsWith("::ffff:")) {
            value = value.substring("::ffff:".length());
        }
        return value;
    }

    private static boolean isLoopback(String ip) {
        return "::1".equals(ip) || "0:0:0:0:0:0:0:1".equals(ip) || ip.startsWith("127.");
    }

    private static boolean isIntranet(String ip) {
        if (ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("169.254.")) {
            return true;
        }
        if (ip.startsWith("172.")) {
            String[] parts = ip.split("\\.");
            if (parts.length > 1) {
                try {
                    int second = Integer.parseInt(parts[1]);
                    return second >= 16 && second <= 31;
                } catch (NumberFormatException ignored) {
                    return false;
                }
            }
        }
        // IPv6：fe80::/10 链路本地、fc00::/7 唯一本地地址
        return ip.startsWith("fe80") || ip.startsWith("fc") || ip.startsWith("fd");
    }

    /* ── 本机地址探测（回环回退） ──────────────────────────────────────── */

    /** 本机地址探测结果缓存时长：审计写入路径避免每次请求枚举网卡，切换网络后最迟半分钟恢复。 */
    private static final long LOCAL_ADDRESS_TTL_MILLIS = 30_000;

    /** 本机地址探测入口，volatile 便于测试替换；返回 null 表示探测不到（调用方保留原回环地址）。 */
    private static volatile Supplier<String> localAddressSupplier = ClientInfoResolver::detectLocalAddressCached;

    private static volatile String cachedLocalAddress;
    private static volatile long cachedLocalAddressAt;

    /** 测试用：替换本机地址探测（传 null 恢复默认实现）。 */
    static void setLocalAddressSupplierForTest(Supplier<String> supplier) {
        localAddressSupplier = supplier == null ? ClientInfoResolver::detectLocalAddressCached : supplier;
        cachedLocalAddress = null;
        cachedLocalAddressAt = 0L;
    }

    /**
     * 本机网卡真实地址（回环回退用）：多网卡时优先「非虚拟适配器的私网 IPv4」，
     * 逐级放宽到含虚拟适配器；探测失败返回 null。
     */
    static String localAddress() {
        return localAddressSupplier.get();
    }

    private static String detectLocalAddressCached() {
        String cached = cachedLocalAddress;
        if (cached != null && System.currentTimeMillis() - cachedLocalAddressAt < LOCAL_ADDRESS_TTL_MILLIS) {
            return cached;
        }
        String detected = detectLocalAddress();
        if (detected != null) {
            cachedLocalAddress = detected;
            cachedLocalAddressAt = System.currentTimeMillis();
        }
        return detected;
    }

    private static String detectLocalAddress() {
        String strict = scanLocalIpv4(true);
        if (strict != null && isIntranet(normalizeIp(strict))) {
            return strict;
        }
        String relaxed = scanLocalIpv4(false);
        if (relaxed != null && isIntranet(normalizeIp(relaxed))) {
            return relaxed;
        }
        return strict != null ? strict : relaxed;
    }

    /** 扫描 up 状态网卡的 IPv4：优先私网地址；excludeVirtual 为 true 时跳过虚拟适配器。 */
    private static String scanLocalIpv4(boolean excludeVirtual) {
        try {
            String fallback = null;
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces.hasMoreElements()) {
                NetworkInterface nic = interfaces.nextElement();
                if (!nic.isUp() || nic.isLoopback() || (excludeVirtual && isVirtualNic(nic))) {
                    continue;
                }
                Enumeration<InetAddress> addresses = nic.getInetAddresses();
                while (addresses.hasMoreElements()) {
                    InetAddress address = addresses.nextElement();
                    if (!(address instanceof Inet4Address) || address.isLoopbackAddress() || address.isLinkLocalAddress()) {
                        continue;
                    }
                    String ip = address.getHostAddress();
                    if (isIntranet(normalizeIp(ip))) {
                        return ip;
                    }
                    if (fallback == null) {
                        fallback = ip;
                    }
                }
            }
            return fallback;
        } catch (SocketException | RuntimeException ignored) {
            return null;
        }
    }

    /**
     * 虚拟适配器启发式识别：VMware / VirtualBox / Hyper-V / WSL / Docker 等；
     * TAP-Windows / WinTun（OpenVPN、WireGuard、Clash 等隧道）与常见内网穿透适配器也应排除，
     * 否则本机地址会落到 VPN 隧道地址而不是物理网卡。
     */
    private static boolean isVirtualNic(NetworkInterface nic) {
        if (nic.isVirtual()) {
            return true;
        }
        String name = (String.valueOf(nic.getDisplayName()) + " " + String.valueOf(nic.getName())).toLowerCase(Locale.ROOT);
        return name.contains("vmware") || name.contains("virtualbox") || name.contains("vbox")
                || name.contains("vethernet") || name.contains("hyper-v") || name.contains("wsl")
                || name.contains("docker") || name.contains("vpn") || name.contains("tunnel")
                || name.contains("tap-") || name.contains("tap_") || name.contains("wintun")
                || name.contains("tailscale") || name.contains("zerotier") || name.contains("radmin");
    }
}
