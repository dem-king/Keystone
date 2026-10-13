package com.keystone.framework.web;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.util.Locale;

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

    /** 客户端 IP：优先代理转发头（X-Forwarded-For 取第一段），其次 X-Real-IP，最后直连地址。 */
    public static String resolveIp(HttpServletRequest request) {
        if (request == null) {
            return null;
        }
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            return forwarded.split(",")[0].trim();
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
}
