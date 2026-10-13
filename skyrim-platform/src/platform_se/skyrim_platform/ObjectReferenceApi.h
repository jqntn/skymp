#pragma once

#include "NapiHelper.h"

namespace ObjectReferenceApi {

Napi::Value SetCollision(const Napi::CallbackInfo& info);
Napi::Value GetReferenceAliasQuests(const Napi::CallbackInfo& info);

inline void Register(Napi::Env env, Napi::Object& exports)
{
  exports.Set(
    "setCollision",
    Napi::Function::New(env, NapiHelper::WrapCppExceptions(SetCollision)));
  exports.Set("getReferenceAliasQuests",
              Napi::Function::New(
                env, NapiHelper::WrapCppExceptions(GetReferenceAliasQuests)));
}
}
