package com.keystone.framework.security;

import org.springframework.data.redis.core.Cursor;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.TimeUnit;

@Service
public class TokenStore {

    private static final String TOKEN_KEY_PREFIX = "auth:token:";

    /** SCAN 的每批游标大小，取值键的批量大小 */
    private static final int SCAN_COUNT = 500;
    private static final int BATCH_SIZE = 200;

    private final StringRedisTemplate redisTemplate;

    public TokenStore(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    public void store(String token, String username, long expiresSeconds) {
        redisTemplate.opsForValue().set(key(token), username, expiresSeconds, TimeUnit.SECONDS);
    }

    public Optional<String> usernameOf(String token) {
        return Optional.ofNullable(redisTemplate.opsForValue().get(key(token)));
    }

    public void revoke(String token) {
        redisTemplate.delete(key(token));
    }

    /**
     * 在线用户数 = 当前有效会话（auth:token:*）按账号去重后的人数。
     * 同一账号多处/多次登录会持有多个 token，只计 1 人；退出登录（revoke）或 token 过期后自动减少。
     */
    public long countOnlineUsers() {
        Set<String> usernames = new HashSet<>();
        List<String> batch = new ArrayList<>(BATCH_SIZE);
        ScanOptions options = ScanOptions.scanOptions().match(TOKEN_KEY_PREFIX + "*").count(SCAN_COUNT).build();
        try (Cursor<String> cursor = redisTemplate.scan(options)) {
            while (cursor.hasNext()) {
                batch.add(cursor.next());
                if (batch.size() >= BATCH_SIZE) {
                    collectUsernames(batch, usernames);
                }
            }
        }
        collectUsernames(batch, usernames);
        return usernames.size();
    }

    /** 批量取出 token 对应的账号并去重；key 之间可能已过期，取到 null 直接跳过 */
    private void collectUsernames(List<String> keys, Set<String> usernames) {
        if (keys.isEmpty()) {
            return;
        }
        List<String> values = redisTemplate.opsForValue().multiGet(keys);
        if (values != null) {
            for (String value : values) {
                if (value != null && !value.isBlank()) {
                    usernames.add(value);
                }
            }
        }
        keys.clear();
    }

    private String key(String token) {
        return TOKEN_KEY_PREFIX + token;
    }
}
