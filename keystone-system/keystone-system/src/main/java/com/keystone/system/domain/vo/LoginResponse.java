package com.keystone.system.domain.vo;

public record LoginResponse(String token, long expiresIn) {
}
