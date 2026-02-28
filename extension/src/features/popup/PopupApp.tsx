import React, { useState } from "react";
import { Button, TextInput } from "../../components/atoms";

function PopupApp() {
  const [userName, setUserName] = useState("");
  const [saved, setSaved] = useState(false);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value.slice(0, 20);
    setUserName(nextValue);
    setSaved(false);
  };

  const handleSave = () => {
    localStorage.setItem("dp_party_user_name", userName);
    setSaved(true);
  };

  return (
    <main className="w-80 bg-white p-4 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <h1 className="mb-4 text-center text-xl font-bold">dP Party Config</h1>
      <h2 className="mb-2 text-left text-base font-semibold">ユーザー名</h2>
      <div className="space-y-3">
        <TextInput
          type="text"
          value={userName}
          onChange={handleChange}
          maxLength={20}
          placeholder="20文字以内で入力"
        />
        <p className="text-right text-xs text-slate-500 dark:text-slate-400">{userName.length}/20</p>
        <Button onClick={handleSave} fullWidth>
          保存
        </Button>
        {saved ? <p className="text-center text-xs text-emerald-400">保存しました</p> : null}
      </div>
    </main>
  );
}

export default PopupApp;
