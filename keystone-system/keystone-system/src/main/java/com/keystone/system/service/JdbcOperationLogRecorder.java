package com.keystone.system.service;

import com.keystone.framework.audit.OperationLogEntry;
import com.keystone.framework.audit.OperationLogRecorder;
import com.keystone.framework.web.ClientInfoResolver;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class JdbcOperationLogRecorder implements OperationLogRecorder {

    private final JdbcTemplate jdbcTemplate;

    public JdbcOperationLogRecorder(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public void record(OperationLogEntry entry) {
        jdbcTemplate.update("""
                INSERT INTO sys_oper_log (module, action, request_method, request_url, request_params,
                    oper_name, dept_name, ip, location, cost, result, error_msg)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                entry.module(),
                entry.action(),
                entry.requestMethod(),
                entry.requestUrl(),
                entry.requestParams(),
                entry.operator(),
                null,
                entry.ip(),
                ClientInfoResolver.resolveLocation(entry.ip()),
                entry.cost(),
                entry.result(),
                entry.errorMessage()
        );
    }
}
