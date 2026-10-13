package com.keystone.system.controller;

import com.keystone.common.domain.R;
import com.keystone.common.exception.BusinessException;
import com.keystone.framework.audit.OperLog;
import com.keystone.framework.security.CaptchaService;
import com.keystone.system.domain.dto.ChangePasswordRequest;
import com.keystone.system.domain.dto.LoginRequest;
import com.keystone.system.domain.vo.CurrentUserResponse;
import com.keystone.system.domain.vo.LoginResponse;
import com.keystone.system.service.AuthService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;
    private final CaptchaService captchaService;

    public AuthController(AuthService authService, CaptchaService captchaService) {
        this.authService = authService;
        this.captchaService = captchaService;
    }

    @GetMapping("/captcha")
    public R<Map<String, String>> captcha() {
        return R.success(captchaService.generate());
    }

    @PostMapping("/login")
    public R<LoginResponse> login(@Valid @RequestBody LoginRequest request) {
        if (!captchaService.verify(request.getCaptchaUuid(), request.getCaptcha())) {
            throw new BusinessException("验证码错误或已过期");
        }
        return R.success(authService.login(request));
    }

    @PostMapping("/logout")
    public R<Void> logout() {
        authService.logout();
        return R.success(null);
    }

    @GetMapping("/me")
    public R<CurrentUserResponse> me() {
        return R.success(authService.currentUser());
    }

    @GetMapping("/routes")
    public R<Map<String, Object>> routes() {
        return R.success(authService.routes());
    }

    @PutMapping("/password")
    @OperLog(module = "账号安全", action = "修改密码")
    public R<Void> changePassword(@Valid @RequestBody ChangePasswordRequest request) {
        authService.changePassword(request);
        return R.success(null);
    }
}
