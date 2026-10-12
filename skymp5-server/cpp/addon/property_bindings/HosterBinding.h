#pragma once
#include "PropertyBinding.h"

class HosterBinding : public PropertyBinding
{
public:
  std::string GetPropertyName() const override { return "hoster"; }
  Napi::Value Get(Napi::Env env, ScampServer& scampServer,
                  uint32_t formId) override;
};
