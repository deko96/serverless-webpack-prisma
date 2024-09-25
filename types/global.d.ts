declare global {
  type ServerlessWriteText = (message: string | string[]) => void;

  type ServerlessCommands = {
    [key: string]: Function;
  };

  type ServerlessHooks = {
    [key: string]: Function;
  };

  type ServerlessContext = {
    writeText: ServerlessWriteText;
  };
}

export {};
