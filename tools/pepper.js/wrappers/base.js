// Copyright (c) 2013 Google Inc. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

(function() {
  var DoLog = function(level, value) {
    // TODO enum?
    if (level == 2) {
      console.warn(value);
    } else if (level == 3) {
      console.error(value);
    } else {
      console.log(value);
    }
  }

  var Console_Log = function(instance, level, value) {
    DoLog(level, glue.memoryToJSVar(value));
  };

  var Console_LogWithSource = function(instance, level, source, value) {
    DoLog(level, glue.memoryToJSVar(source) + ": " + glue.memoryToJSVar(value));
  };

  registerInterface("PPB_Console;1.0", [
    Console_Log,
    Console_LogWithSource
  ]);


  var Core_AddRefResource = function(uid) {
    resources.addRef(uid);
  };

  var Core_ReleaseResource = function(uid) {
    resources.release(uid);
  };

  var Core_GetTime = function() {
    return (new Date()) / 1000;
  };

  var Core_GetTimeTicks = function() {
    return performance.now() / 1000;
  };

  var Core_CallOnMainThread = function(delay, callback, result) {
    var js_callback = glue.getCompletionCallback(callback);
    setTimeout(function() {
      js_callback(result);
    }, delay);
  };

  var Core_IsMainThread = function() {
    return 1;
  };

  registerInterface("PPB_Core;1.0", [
    Core_AddRefResource,
    Core_ReleaseResource,
    Core_GetTime,
    Core_GetTimeTicks,
    Core_CallOnMainThread,
    Core_IsMainThread
  ]);


  var Instance_BindGraphics = function(instance, device) {
    var inst = resources.resolve(instance, INSTANCE_RESOURCE);
    if (inst === undefined) {
      return 0;
    }
    if (device === 0) {
        inst.unbind();
        return 1;
    }
    var dev = resources.resolve(device, GRAPHICS_3D_RESOURCE, true) || resources.resolve(device, GRAPHICS_2D_RESOURCE, true);
    if (dev === undefined) {
        return 0;
    }
    inst.bind(dev);
    return 1;
  };

  var Instance_IsFullFrame = function(instance) {
    // Only true for MIME handlers - which are not supported.
    return 0;
  };

  registerInterface("PPB_Instance;1.0", [
    Instance_BindGraphics,
    Instance_IsFullFrame
  ]);


  var Messaging_PostMessage = function(instance, value) {
    var inst = resources.resolve(instance, INSTANCE_RESOURCE);
    if (inst == undefined) {
      return;
    }
    var evt = document.createEvent('Event');
    evt.initEvent('message', true, true);  // bubbles, cancelable
    evt.data = glue.memoryToJSVar(value);
    // dispatchEvent is resolved synchonously, defer it to prevent reentrancy.
    glue.defer(function() {
      inst.element.dispatchEvent(evt);
    });
  };

  var Messaging_RegisterMessageHandler = function(instance, user_data, handler, message_loop) {
    // We should return PP_ERROR_WRONG_THREAD here, because Pepper API
    // docs [1] disallow calling RegisterMessageHandler on main thread's
    // MessageLoop. pepper.js can only run on a single thread due to
    // Emscripten/WebAssembly limitations, so every call to
    // RegisterMessageHandler is on the main thread's MessageLoop.
    //
    // Our PPB_Messaging::RegisterMessageHandler implementation is the closest
    // behavior we can get in single-threaded environment. It will replace
    // handler from PPP_Messaging struct, but will be called on the main
    // thread.
    //
    // `message_loop` argument is ignored.
    //
    // [1] https://developer.chrome.com/native-client/pepper_dev/c/struct_p_p_b___messaging__1__2#ae5abee73dc21a290514f7f3554a7e895
    var inst = resources.resolve(instance, INSTANCE_RESOURCE);
    if (inst == undefined) {
      return ppapi.PP_ERROR_BADRESOURCE;
    }

    var PPP_MessageHandler_HandleMessage = getValue(handler, 'i32');
    // TODO: investigate HandleBlockingMessage
    var PPP_MessageHandler_HandleBlockingMessage = getValue(handler + 4, 'i32');
    // TODO: call Destroy somewhere
    var PPP_MessageHandler_Destroy = getValue(handler + 8, 'i32');

    inst._registeredMessageHandler = function(instance, var_message) {
      Runtime.dynCall('viii', PPP_MessageHandler_HandleMessage, [instance, user_data, var_message]);
    };

    return ppapi.PP_OK;
  }

  var Messaging_UnregisterMessageHandler = function(instance) {
    var inst = resources.resolve(instance, INSTANCE_RESOURCE);
    if (inst == undefined) {
      return;
    }

    inst._registeredMessageHandler = null;
  }

  registerInterface("PPB_Messaging;1.0", [
    Messaging_PostMessage
  ]);

  registerInterface("PPB_Messaging;1.2", [
    Messaging_PostMessage,
    Messaging_RegisterMessageHandler,
    Messaging_UnregisterMessageHandler,
  ]);

  var Var_AddRef = function(v) {
    if (glue.isRefCountedVarType(glue.getVarType(v))) {
      resources.addRef(glue.getVarUID(v));
    }
  };

  var Var_Release = function(v) {
    if (glue.isRefCountedVarType(glue.getVarType(v))) {
      resources.release(glue.getVarUID(v));
    }
  };

  var Var_VarFromUtf8_1_0 = function(result, module, ptr, len) {
    Var_VarFromUtf8_1_1(result, ptr, len);
  };

  var Var_VarFromUtf8_1_1 = function(result, ptr, len) {
    var value = glue.decodeUTF8(ptr, len);

    // Not a valid UTF-8 string.  Return null.
    if (value === null) {
      glue.jsToMemoryVar(null, result);
      return
    }

    // Create a copy of the string.
    // TODO more efficient copy?
    var memory = _malloc(len + 1);
    for (var i = 0; i < len; i++) {
      HEAPU8[memory + i] = HEAPU8[ptr + i];
    }
    // Null terminate the string because why not?
    HEAPU8[memory + len] = 0;

    // Generate the return value.
    setValue(result, ppapi.PP_VARTYPE_STRING, 'i32');
    setValue(result + 8, resources.registerString(value, memory, len), 'i32');
  };

  var Var_VarToUtf8 = function(v, lenptr) {
    // Defensively set the length to zero so that we can early out at any point.
    setValue(lenptr, 0, 'i32');

    if (glue.getVarType(v) !== ppapi.PP_VARTYPE_STRING) {
      return 0;
    }
    var uid = glue.getVarUID(v);
    var resource = resources.resolve(uid, STRING_RESOURCE);
    if (resource === undefined) {
      return 0;
    }
    setValue(lenptr, resource.len, 'i32');
    return resource.memory;
  };

  // Var/Resource conversion is not needed until we have better support for
  // media streams and file systems.

  var Var_VarToResource = function(v) {
    throw "Var_VarToResource not implemented";
  };

  var Var_VarFromResource = function(r) {
    throw "Var_VarFromResource not implemented";
  };

  registerInterface("PPB_Var;1.0", [
    Var_AddRef,
    Var_Release,
    Var_VarFromUtf8_1_0,
    Var_VarToUtf8
  ]);

  registerInterface("PPB_Var;1.1", [
    Var_AddRef,
    Var_Release,
    Var_VarFromUtf8_1_1,
    Var_VarToUtf8
  ]);

  registerInterface("PPB_Var;1.2", [
    Var_AddRef,
    Var_Release,
    Var_VarFromUtf8_1_1,
    Var_VarToUtf8,
    Var_VarToResource,
    Var_VarFromResource
  ]);


  var VarArray_Create = function(result) {
    glue.structToMemoryVar({
      type: ppapi.PP_VARTYPE_ARRAY,
      value: resources.registerArray([])
    }, result);
  };

  var VarArray_Get = function(result, array, index) {
    if (glue.getVarType(array) === ppapi.PP_VARTYPE_ARRAY) {
      var a = resources.resolve(glue.getVarUID(array), ARRAY_RESOURCE);
      if (a !== undefined && index < a.value.length) {
        var e = a.value[index];
        glue.structToMemoryVar(e, result);
        glue.structAddRef(e);
        return;
      }
    }
    glue.jsToMemoryVar(undefined, result);
  };

  var VarArray_Set = function(array, index, value) {
    if (glue.getVarType(array) !== ppapi.PP_VARTYPE_ARRAY) {
      return 0;
    }
    var a = resources.resolve(glue.getVarUID(array), ARRAY_RESOURCE);
    if (a === undefined) {
      return 0;
    }
    if (index >= a.value.length) {
      return 0;
    }
    glue.structRelease(a.value[index]);
    a.value[index] = glue.memoryToStructVar(value);
    glue.structAddRef(a.value[index]);
    return 1;
  };

  var VarArray_GetLength = function(array) {
    if (glue.getVarType(array) !== ppapi.PP_VARTYPE_ARRAY) {
      return 0;
    }
    var a = resources.resolve(glue.getVarUID(array), ARRAY_RESOURCE);
    if (a === undefined) {
      return 0;
    }
    return a.value.length;
  };

  var VarArray_SetLength = function(array, length) {
    if (glue.getVarType(array) !== ppapi.PP_VARTYPE_ARRAY) {
      return 0;
    }
    var a = resources.resolve(glue.getVarUID(array), ARRAY_RESOURCE);
    if (a === undefined) {
      return 0;
    }
    a.setLength(length);
    return 1;
  };

  registerInterface("PPB_VarArray;1.0", [
    VarArray_Create,
    VarArray_Get,
    VarArray_Set,
    VarArray_GetLength,
    VarArray_SetLength,
  ]);


  var VarDictionary_Create = function(result) {
    glue.structToMemoryVar({
      type: ppapi.PP_VARTYPE_DICTIONARY,
      value: resources.registerDictionary({})
    }, result);
  };

  var VarDictionary_Get = function(result, dict, key) {
    if (glue.getVarType(dict) === ppapi.PP_VARTYPE_DICTIONARY &&
        glue.getVarType(key) === ppapi.PP_VARTYPE_STRING) {
      var d = resources.resolve(glue.getVarUID(dict), DICTIONARY_RESOURCE);
      var k = resources.resolve(glue.getVarUID(key), STRING_RESOURCE);
      if (d !== undefined && k !== undefined && k.value in d.value) {
        var e = d.value[k.value];
        glue.structAddRef(e);
        glue.structToMemoryVar(e, result);
        return;
      }
    }
    glue.jsToMemoryVar(undefined, result);
    return;
  };

  var VarDictionary_Set = function(dict, key, value) {
    if (glue.getVarType(dict) === ppapi.PP_VARTYPE_DICTIONARY &&
        glue.getVarType(key) === ppapi.PP_VARTYPE_STRING) {
      var d = resources.resolve(glue.getVarUID(dict), DICTIONARY_RESOURCE);
      var k = resources.resolve(glue.getVarUID(key), STRING_RESOURCE);
      if (d !== undefined && k !== undefined) {
        d.remove(k.value);
        var e = glue.memoryToStructVar(value);
        glue.structAddRef(e);
        d.value[k.value] = e;
      }
    }
  };

  var VarDictionary_Delete = function(dict, key) {
    if (glue.getVarType(dict) === ppapi.PP_VARTYPE_DICTIONARY &&
        glue.getVarType(key) === ppapi.PP_VARTYPE_STRING) {
      var d = resources.resolve(glue.getVarUID(dict), DICTIONARY_RESOURCE);
      var k = resources.resolve(glue.getVarUID(key), STRING_RESOURCE);
      if (d !== undefined && k !== undefined) {
        d.remove(k.value);
      }
    }
  };

  var VarDictionary_HasKey = function(dict, key) {
    if (glue.getVarType(dict) === ppapi.PP_VARTYPE_DICTIONARY &&
        glue.getVarType(key) === ppapi.PP_VARTYPE_STRING) {
      var d = resources.resolve(glue.getVarUID(dict), DICTIONARY_RESOURCE);
      var k = resources.resolve(glue.getVarUID(key), STRING_RESOURCE);
      if (d !== undefined && k !== undefined && k.value in d.value) {
        return 1;
      }
    }
    return 0;
  };

  var VarDictionary_GetKeys = function(result, dict) {
    var d = undefined;
    if (glue.getVarType(dict) === ppapi.PP_VARTYPE_DICTIONARY) {
      d = resources.resolve(glue.getVarUID(dict), DICTIONARY_RESOURCE);
    }
    if (d === undefined) {
      // Note: it is somewhat inconsistent to return "null" rather than
      // "undefined" but this is what the spec says and what Chrome does.
      glue.jsToMemoryVar(null, result);
      return;
    }

    var wrapped = [];
    for (var key in d.value) {
      wrapped.push(glue.jsToStructVar(key));
    }

    glue.structToMemoryVar({
      type: ppapi.PP_VARTYPE_ARRAY,
      value: resources.registerArray(wrapped)
    }, result);
  };

  registerInterface("PPB_VarDictionary;1.0", [
    VarDictionary_Create,
    VarDictionary_Get,
    VarDictionary_Set,
    VarDictionary_Delete,
    VarDictionary_HasKey,
    VarDictionary_GetKeys,
  ]);


  var VarArrayBuffer_Create = function(var_ptr, size_in_bytes) {
    var memory = _malloc(size_in_bytes);

    glue.structToMemoryVar({
      type: ppapi.PP_VARTYPE_ARRAY_BUFFER,
      value: resources.registerArrayBuffer(memory, size_in_bytes),
    }, var_ptr);
  }

  var VarArrayBuffer_ByteLength = function(var_ptr, byte_length_ptr) {
    var uid = glue.getVarUID(var_ptr);
    var resource = resources.resolve(uid, ARRAY_BUFFER_RESOURCE);
    if (resource === undefined) {
      return 0;
    }

    setValue(byte_length_ptr, resource.len, 'i32');
    return 1;
  }

  var VarArrayBuffer_Map = function(var_ptr) {
    if (glue.getVarType(var_ptr) !== ppapi.PP_VARTYPE_ARRAY_BUFFER) {
      return 0;
    }
    var uid = glue.getVarUID(var_ptr);
    var resource = resources.resolve(uid, ARRAY_BUFFER_RESOURCE);
    if (resource === undefined) {
      return 0;
    }
    return resource.memory;
  }

  var VarArrayBuffer_Unmap = function(var_ptr) {
    // Currently a nop because the data is always mapped.
  }

  registerInterface("PPB_VarArrayBuffer;1.0", [
    VarArrayBuffer_Create,
    VarArrayBuffer_ByteLength,
    VarArrayBuffer_Map,
    VarArrayBuffer_Unmap
  ]);

})();
