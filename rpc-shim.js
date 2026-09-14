(function installParallelRpcBridge(global) {
  'use strict';

  var endpoint = global.TG_PARALLEL_RPC_URL || '';
  var retryDelays = [0, 350, 1000, 2500];

  function rpcError(message) {
    var error = new Error(String(message || '앱 서버 요청에 실패했습니다.'));
    error.name = 'ParallelRpcError';
    return error;
  }

  function currentAuth() {
    if (typeof global.__tgParallelRpcAuth === 'function') {
      return global.__tgParallelRpcAuth() || {};
    }
    return {};
  }

  function invoke(method, args, success, failure) {
    if (!endpoint) {
      if (failure) failure(rpcError('병렬 앱 API 주소가 설정되지 않았습니다.'));
      return;
    }
    var requestBody = JSON.stringify({
      transport: 'tg-parallel-rpc-v1',
      method: method,
      args: args,
      auth: currentAuth()
    });

    function attempt(index) {
      setTimeout(function() {
        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: requestBody,
          redirect: 'follow'
        }).then(function(response) {
          if (!response.ok) {
            var transient = response.status === 404 || response.status === 408 || response.status === 429 || response.status >= 500;
            if (transient && index + 1 < retryDelays.length) {
              attempt(index + 1);
              return null;
            }
            throw rpcError('앱 서버 HTTP ' + response.status);
          }
          return response.json();
        }).then(function(payload) {
          if (payload === null) return;
          if (!payload || payload.ok !== true) throw rpcError(payload && payload.error);
          if (success) success(payload.result);
        }).catch(function(error) {
          if (index + 1 < retryDelays.length && !(error && error.name === 'ParallelRpcError')) {
            attempt(index + 1);
            return;
          }
          if (failure) failure(error && error.message ? error : rpcError(error));
        });
      }, retryDelays[index]);
    }

    attempt(0);
  }

  function createRunner() {
    var success = null;
    var failure = null;
    var runner = new Proxy({}, {
      get: function(_, property) {
        if (property === 'withSuccessHandler') {
          return function(handler) { success = handler; return runner; };
        }
        if (property === 'withFailureHandler') {
          return function(handler) { failure = handler; return runner; };
        }
        return function() { invoke(String(property), Array.prototype.slice.call(arguments), success, failure); };
      }
    });
    return runner;
  }

  var googleObject = global.google || {};
  googleObject.script = googleObject.script || {};
  Object.defineProperty(googleObject.script, 'run', {
    configurable: true,
    get: createRunner
  });
  global.google = googleObject;
})(window);
