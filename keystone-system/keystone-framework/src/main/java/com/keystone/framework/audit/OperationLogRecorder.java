package com.keystone.framework.audit;

public interface OperationLogRecorder {

    void record(OperationLogEntry entry);
}
