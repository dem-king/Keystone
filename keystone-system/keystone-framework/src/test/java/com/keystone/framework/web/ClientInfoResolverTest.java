package com.keystone.framework.web;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import static org.assertj.core.api.Assertions.assertThat;

class ClientInfoResolverTest {

    private static final String CHROME_WINDOWS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            + "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    private static final String EDGE_WINDOWS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            + "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.91";
    private static final String FIREFOX_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0";
    private static final String SAFARI_MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
            + "(KHTML, like Gecko) Version/17.1 Safari/605.1.15";
    private static final String WECHAT_ANDROID_UA = "Mozilla/5.0 (Linux; Android 13; PGZ110 Build/TP1A.220905.001) "
            + "AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/86.0.4240.99 XWEB/4399 MMWEBSDK/20230510 "
            + "Mobile Safari/537.36 MMWEBID/8006 MicroMessenger/8.0.42.2460(0x28002A37) WeChat/arm64 Weixin Android";
    private static final String QQ_BROWSER_UA = "Mozilla/5.0 (Linux; U; Android 12) AppleWebKit/537.36 "
            + "(KHTML, like Gecko) Version/4.0 Chrome/89.0.4389.116 MQQBrowser/12.3 Mobile Safari/537.36";

    @AfterEach
    void clearContext() {
        RequestContextHolder.resetRequestAttributes();
        ClientInfoResolver.setLocalAddressSupplierForTest(null);
    }

    @Test
    void resolvesBrowserFromUserAgent() {
        assertThat(ClientInfoResolver.parseBrowser(CHROME_WINDOWS_UA)).isEqualTo("Chrome");
        assertThat(ClientInfoResolver.parseBrowser(EDGE_WINDOWS_UA)).isEqualTo("Edge");
        assertThat(ClientInfoResolver.parseBrowser(FIREFOX_UA)).isEqualTo("Firefox");
        assertThat(ClientInfoResolver.parseBrowser(SAFARI_MAC_UA)).isEqualTo("Safari");
        assertThat(ClientInfoResolver.parseBrowser(WECHAT_ANDROID_UA)).isEqualTo("微信");
        assertThat(ClientInfoResolver.parseBrowser(QQ_BROWSER_UA)).isEqualTo("QQ浏览器");
        assertThat(ClientInfoResolver.parseBrowser(null)).isNull();
        assertThat(ClientInfoResolver.parseBrowser(" ")).isNull();
        assertThat(ClientInfoResolver.parseBrowser("curl/8.4.0")).isNull();
    }

    @Test
    void resolvesOsFromUserAgent() {
        assertThat(ClientInfoResolver.parseOs(CHROME_WINDOWS_UA)).isEqualTo("Windows");
        assertThat(ClientInfoResolver.parseOs(SAFARI_MAC_UA)).isEqualTo("macOS");
        assertThat(ClientInfoResolver.parseOs(WECHAT_ANDROID_UA)).isEqualTo("Android");
        assertThat(ClientInfoResolver.parseOs("Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) "
                + "AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148")).isEqualTo("iOS");
        assertThat(ClientInfoResolver.parseOs("Mozilla/5.0 (Linux; Android 12; HarmonyOS; ALN-AL00) "
                + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36")).isEqualTo("HarmonyOS");
        assertThat(ClientInfoResolver.parseOs("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                + "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")).isEqualTo("Linux");
        assertThat(ClientInfoResolver.parseOs(null)).isNull();
    }

    @Test
    void resolvesLocationForLoopbackAndIntranetOnly() {
        assertThat(ClientInfoResolver.resolveLocation(null)).isNull();
        assertThat(ClientInfoResolver.resolveLocation(" ")).isNull();
        assertThat(ClientInfoResolver.resolveLocation("127.0.0.1")).isEqualTo("本机");
        assertThat(ClientInfoResolver.resolveLocation("127.0.0.5")).isEqualTo("本机");
        assertThat(ClientInfoResolver.resolveLocation("::1")).isEqualTo("本机");
        assertThat(ClientInfoResolver.resolveLocation("0:0:0:0:0:0:0:1")).isEqualTo("本机");
        assertThat(ClientInfoResolver.resolveLocation("127.0.0.1 ")).isEqualTo("本机");
    }

    @Test
    void resolvesLocationForPrivateRanges() {
        assertThat(ClientInfoResolver.resolveLocation("10.1.2.3")).isEqualTo("内网");
        assertThat(ClientInfoResolver.resolveLocation("192.168.1.30")).isEqualTo("内网");
        assertThat(ClientInfoResolver.resolveLocation("172.16.0.1")).isEqualTo("内网");
        assertThat(ClientInfoResolver.resolveLocation("172.31.255.254")).isEqualTo("内网");
        assertThat(ClientInfoResolver.resolveLocation("169.254.10.1")).isEqualTo("内网");
        assertThat(ClientInfoResolver.resolveLocation("::ffff:192.168.1.5")).isEqualTo("内网");
        assertThat(ClientInfoResolver.resolveLocation("fe80::c2b8:47ff:fe12:3456")).isEqualTo("内网");
    }

    @Test
    void leavesPublicAndInvalidAddressesUnlabeled() {
        assertThat(ClientInfoResolver.resolveLocation("8.8.8.8")).isNull();
        assertThat(ClientInfoResolver.resolveLocation("172.15.0.1")).isNull();
        assertThat(ClientInfoResolver.resolveLocation("172.32.0.1")).isNull();
        assertThat(ClientInfoResolver.resolveLocation("172.")).isNull();
        assertThat(ClientInfoResolver.resolveLocation("203.0.113.7")).isNull();
    }

    @Test
    void resolvesIpWithProxyHeaderPriority() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("10.0.0.9");

        assertThat(ClientInfoResolver.resolveIp(request)).isEqualTo("10.0.0.9");

        request.addHeader("X-Real-IP", "10.0.0.8");
        assertThat(ClientInfoResolver.resolveIp(request)).isEqualTo("10.0.0.8");

        request.addHeader("X-Forwarded-For", "203.0.113.7, 10.0.0.2");
        assertThat(ClientInfoResolver.resolveIp(request)).isEqualTo("203.0.113.7");

        assertThat(ClientInfoResolver.resolveIp(null)).isNull();
    }

    @Test
    void fallsBackToLocalAddressForLoopbackRequests() {
        ClientInfoResolver.setLocalAddressSupplierForTest(() -> "192.168.10.20");
        MockHttpServletRequest direct = new MockHttpServletRequest();
        direct.setRemoteAddr("127.0.0.1");
        assertThat(ClientInfoResolver.resolveIp(direct)).isEqualTo("192.168.10.20");

        // 代理头传来回环地址（本机开发服务器转发）时同样回退
        MockHttpServletRequest proxied = new MockHttpServletRequest();
        proxied.setRemoteAddr("127.0.0.1");
        proxied.addHeader("X-Forwarded-For", "127.0.0.1");
        assertThat(ClientInfoResolver.resolveIp(proxied)).isEqualTo("192.168.10.20");
    }

    @Test
    void keepsLoopbackWhenLocalAddressUnavailable() {
        ClientInfoResolver.setLocalAddressSupplierForTest(() -> null);
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("::1");
        assertThat(ClientInfoResolver.resolveIp(request)).isEqualTo("::1");
    }

    @Test
    void doesNotReplaceNonLoopbackAddresses() {
        ClientInfoResolver.setLocalAddressSupplierForTest(() -> "192.168.10.20");
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("10.0.0.9");
        request.addHeader("X-Forwarded-For", "203.0.113.7, 10.0.0.2");
        assertThat(ClientInfoResolver.resolveIp(request)).isEqualTo("203.0.113.7");
    }

    @Test
    void skipsUnknownSegmentsInForwardedFor() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("10.0.0.9");
        request.addHeader("X-Forwarded-For", "unknown, 203.0.113.7");
        assertThat(ClientInfoResolver.resolveIp(request)).isEqualTo("203.0.113.7");
    }

    @Test
    void detectsLocalIpv4AddressOnThisMachine() {
        assertThat(ClientInfoResolver.localAddress())
                .matches("\\d{1,3}(\\.\\d{1,3}){3}")
                .doesNotStartWith("127.")
                .doesNotStartWith("169.254.");
    }

    @Test
    void buildsClientInfoFromCurrentRequestContext() {
        assertThat(ClientInfoResolver.current().ip()).isNull();

        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("192.168.6.66");
        request.addHeader("User-Agent", EDGE_WINDOWS_UA);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

        ClientInfoResolver.ClientInfo info = ClientInfoResolver.current();
        assertThat(info.ip()).isEqualTo("192.168.6.66");
        assertThat(info.location()).isEqualTo("内网");
        assertThat(info.browser()).isEqualTo("Edge");
        assertThat(info.os()).isEqualTo("Windows");
    }

    @Test
    void currentRequestWithoutUserAgentLeavesClientFieldsNull() {
        ClientInfoResolver.setLocalAddressSupplierForTest(() -> "192.168.10.20");
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("127.0.0.1");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

        ClientInfoResolver.ClientInfo info = ClientInfoResolver.current();
        assertThat(info.ip()).isEqualTo("192.168.10.20");
        assertThat(info.location()).isEqualTo("内网");
        assertThat(info.browser()).isNull();
        assertThat(info.os()).isNull();
    }
}
