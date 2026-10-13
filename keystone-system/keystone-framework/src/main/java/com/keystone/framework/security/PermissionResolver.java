package com.keystone.framework.security;

public interface PermissionResolver {

    boolean hasPermission(String username, String permission);
}
